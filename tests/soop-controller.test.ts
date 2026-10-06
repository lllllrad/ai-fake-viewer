import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SoopController,
  type SoopChat,
  type SoopPorts,
} from "../apps/web/src/features/soop/controller.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class Chat implements SoopChat {
  ready = () => {};
  closed = () => {};
  error = () => {};
  message = (_action: string, _data: unknown) => {};
  connectResult: Promise<unknown> = Promise.resolve();
  room = { bjId: "fixture" };
  disconnected = 0;
  sent: string[] = [];
  setAuth() {}
  handleReady(fn: () => void) {
    this.ready = fn;
  }
  handleChatClosed(fn: () => void) {
    this.closed = fn;
  }
  handleError(fn: () => void) {
    this.error = fn;
  }
  handleMessageReceived(fn: (action: string, data: unknown) => void) {
    this.message = fn;
  }
  async connect() {
    this.ready();
    return this.connectResult;
  }
  async getRoomInfo() {
    return this.room;
  }
  disconnect() {
    this.disconnected++;
    this.closed();
  }
  sendMessage(text: string) {
    this.sent.push(text);
  }
  receive(text: string) {
    this.message("MESSAGE", {
      userId: "viewer",
      userNickname: "Synthetic viewer",
      message: text,
    });
  }
}
function fixture() {
  const chats: Chat[] = [],
    events: string[] = [];
  const ports: SoopPorts = {
    authorization: async () => ({
      clientId: "fixture",
      accessToken: "synthetic",
      streamerId: "fixture",
    }),
    createChat: async () => {
      const chat = new Chat();
      chats.push(chat);
      return chat;
    },
    status: async (state) => {
      events.push(state);
    },
    message: async (message) => {
      events.push(message.message);
    },
    nextNotice: async () => ({ notice: null }),
    failNotice: async (id) => {
      events.push(`failed:${id}`);
    },
  };
  const controller = new SoopController(ports);
  return { ports, chats, events, controller };
}
test("ready alone cannot authorize messages; verified room and ready publish subscription once", async () => {
  const f = fixture(),
    connecting = deferred<unknown>();
  f.ports.createChat = async () => {
    const chat = new Chat();
    chat.connectResult = connecting.promise;
    f.chats.push(chat);
    return chat;
  };
  const task = f.controller.connect();
  await flush();
  const chat = f.chats[0]!;
  chat.receive("before verification");
  assert.deepEqual(f.events, []);
  connecting.resolve(undefined);
  await task;
  chat.ready();
  chat.ready();
  chat.receive("after verification");
  await f.controller.drain();
  assert.deepEqual(f.events, ["subscribed", "after verification"]);
  f.controller.dispose();
});
test("disconnect during connect prevents late room verification, ready, messages and errors from reviving it", async () => {
  const f = fixture(),
    connecting = deferred<unknown>();
  f.ports.createChat = async () => {
    const chat = new Chat();
    chat.connectResult = connecting.promise;
    f.chats.push(chat);
    return chat;
  };
  const task = f.controller.connect();
  await flush();
  await f.controller.disconnect();
  connecting.resolve(undefined);
  await task;
  const chat = f.chats[0]!;
  chat.ready();
  chat.receive("late");
  chat.error();
  await f.controller.drain();
  assert.equal(f.controller.snapshot().phase, "idle");
  assert.deepEqual(f.events, ["disconnected"]);
  assert.equal(chat.disconnected, 1);
  f.controller.dispose();
});
test("replaced SDK callbacks cannot disconnect or publish into the new connection", async () => {
  const f = fixture();
  await f.controller.connect();
  await f.controller.drain();
  const old = f.chats[0]!;
  await f.controller.connect();
  await f.controller.drain();
  old.closed();
  old.error();
  old.ready();
  old.receive("old message");
  f.chats[1]!.receive("new message");
  await f.controller.drain();
  assert.equal(f.controller.snapshot().phase, "connected");
  assert.deepEqual(f.events, ["subscribed", "subscribed", "new message"]);
  f.controller.dispose();
});
test("reserved notices from an old connection are rejected instead of sent through a replacement", async () => {
  const f = fixture(),
    next = deferred<{
      notice: { id: string; text: string; expiresAt: number };
    }>();
  f.ports.nextNotice = () => next.promise;
  await f.controller.connect();
  const poll = f.controller.poll();
  await f.controller.poll();
  await f.controller.disconnect();
  await f.controller.connect();
  next.resolve({
    notice: {
      id: "notice",
      text: "Synthetic notice",
      expiresAt: Date.now() + 10000,
    },
  });
  await poll;
  assert(f.events.includes("failed:notice"));
  assert(f.chats.every((chat) => chat.sent.length === 0));
  f.controller.dispose();
});
test("forwarding preserves input order and bounds queued message bodies during a slow server", async () => {
  const f = fixture(),
    first = deferred<void>();
  let count = 0;
  f.ports.message = async (message) => {
    if (count++ === 0) await first.promise;
    f.events.push(message.message);
  };
  await f.controller.connect();
  await f.controller.drain();
  const chat = f.chats[0]!;
  for (let i = 0; i < 140; i++) chat.receive(`message-${i}`);
  await flush();
  assert.equal(count, 1);
  first.resolve();
  await f.controller.drain();
  assert.equal(count, 128);
  assert.deepEqual(
    f.events.slice(1),
    Array.from({ length: 128 }, (_, i) => `message-${i}`),
  );
  f.controller.dispose();
});
test("wrong broadcaster messages never enter the message port", async () => {
  const f = fixture();
  f.ports.createChat = async () => {
    const chat = new Chat();
    chat.room = { bjId: "other" };
    f.chats.push(chat);
    return chat;
  };
  await f.controller.connect();
  f.chats[0]!.receive("wrong room");
  await f.controller.drain();
  assert.equal(f.controller.snapshot().phase, "failed");
  assert.deepEqual(f.events, ["failed"]);
  f.controller.dispose();
});
test("a stalled SDK connection times out and cannot complete later", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(),
    connecting = deferred<unknown>();
  f.ports.createChat = async () => {
    const chat = new Chat();
    chat.connectResult = connecting.promise;
    f.chats.push(chat);
    return chat;
  };
  const task = f.controller.connect();
  await flush();
  t.mock.timers.tick(30000);
  await f.controller.drain();
  assert.equal(f.controller.snapshot().phase, "failed");
  connecting.resolve(undefined);
  await task;
  assert.deepEqual(f.events, ["failed"]);
  f.controller.dispose();
});

test("malformed SDK messages are dropped and forwarding failures do not expose response bodies", async () => {
  const f = fixture();
  await f.controller.connect();
  await f.controller.drain();
  const chat = f.chats[0]!;
  for (const data of [
    null,
    {},
    { userId: 3, userNickname: "Fixture", message: "Text" },
  ])
    chat.message("MESSAGE", data);
  await f.controller.drain();
  assert.deepEqual(f.events, ["subscribed"]);
  f.ports.message = async () => {
    throw Error("SYNTHETIC_PRIVATE_RESPONSE");
  };
  chat.receive("Synthetic permitted fixture");
  await f.controller.drain();
  assert(
    !f.controller.snapshot().message.includes("SYNTHETIC_PRIVATE_RESPONSE"),
  );
  assert.match(f.controller.snapshot().message, /전달하지 못했습니다/);
  f.controller.dispose();
});

test("SDK connection errors expose a fixed diagnostic rather than SDK payloads", async () => {
  const f = fixture();
  f.ports.createChat = async () => {
    throw Error("SYNTHETIC_PRIVATE_SDK_RESPONSE");
  };
  await f.controller.connect();
  assert.equal(f.controller.snapshot().phase, "failed");
  assert(!f.controller.snapshot().message.includes("SYNTHETIC_PRIVATE"));
  f.controller.dispose();
});
