import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  runChzzk,
  type ChzzkConnectionPorts,
} from "../packages/infrastructure/platforms/chzzk-connection.ts";
import { ApiQuotaError } from "../packages/api-health.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Worker extends EventEmitter {
  send() {
    return true;
  }
  kill() {
    this.emit("exit", 0);
    return true;
  }
  system(type: string, data?: object) {
    this.emit("message", { type: "SYSTEM", data: { type, data } });
  }
}
function fixture() {
  const controller = new AbortController();
  const workers: Worker[] = [];
  const states: { state: string; api?: string }[] = [];
  const calls: string[] = [];
  const messages: unknown[] = [];
  let recoveries = 0;
  let resets = 0;
  const ports: ChzzkConnectionPorts = {
    account: {
      access: async () => "token",
      api: async (path) => {
        calls.push(path);
        return { url: "https://fixture.nchat.naver.com/socket" };
      },
    },
    worker: () => {
      const worker = new Worker();
      workers.push(worker);
      return worker as unknown as ChildProcess;
    },
    available: (channel) => channel === "room",
    subscribed: () => {},
    receive: (message) => messages.push(message),
    status: (state, api) => states.push({ state, api }),
    recovered: () => {
      recoveries++;
    },
    reset: () => {
      resets++;
    },
    retry: async () => {},
  };
  return {
    ports,
    controller,
    workers,
    states,
    calls,
    messages,
    get recoveries() {
      return recoveries;
    },
    get resets() {
      return resets;
    },
  };
}
function subscribe(worker: Worker) {
  worker.system("subscribed", { eventType: "CHAT", channelId: "room" });
}

test("CHZZK abort during account access does not open a session or worker", async () => {
  const f = fixture();
  const access = deferred<string>();
  f.ports.account.access = () => access.promise;
  const task = runChzzk(f.ports, f.controller.signal);
  f.controller.abort();
  access.resolve("token");
  await task;
  assert.deepEqual(f.calls, []);
  assert.equal(f.workers.length, 0);
  assert.deepEqual(
    f.states.map((s) => s.state),
    ["connecting"],
  );
});

test("CHZZK late subscription rejection cannot change stopped state", async () => {
  const f = fixture();
  const pending = deferred<unknown>();
  const api = f.ports.account.api;
  f.ports.account.api = (path) =>
    path.includes("/subscribe/") ? pending.promise : api(path);
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  const worker = f.workers[0];
  worker.system("connected", { sessionKey: "key" });
  f.controller.abort();
  await task;
  const before = [...f.states];
  pending.reject(new ApiQuotaError("CHZZK subscription"));
  await flush();
  worker.system("subscribed", { eventType: "CHAT", channelId: "room" });
  assert.deepEqual(f.states, before);
  assert.equal(worker.listenerCount("message"), 0);
  assert.equal(f.recoveries, 0);
  assert(f.calls.some((p) => p.includes("/unsubscribe/")));
});

test("CHZZK retired worker callbacks cannot affect its replacement", async () => {
  const f = fixture();
  const pending = deferred<unknown>();
  const api = f.ports.account.api;
  f.ports.account.api = (path) =>
    path.includes("/subscribe/") ? pending.promise : api(path);
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  const old = f.workers[0];
  old.system("connected", { sessionKey: "old" });
  const late = old.listeners("message")[0];
  old.emit("exit", 1);
  await flush();
  assert.equal(f.workers.length, 2);
  subscribe(f.workers[1]);
  const before = [...f.states];
  pending.reject(new ApiQuotaError("old subscription"));
  late({ type: "SYSTEM", data: { type: "revoked" } });
  await flush();
  assert.deepEqual(f.states, before);
  assert.equal(f.states.at(-1)?.state, "subscribed");
  assert.equal(f.recoveries, 1);
  f.controller.abort();
  await task;
});

test("CHZZK admits only subscribed room viewers and unsubscribes once", async () => {
  const f = fixture();
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  const worker = f.workers[0];
  const chat = (room: string, author: string) =>
    worker.emit("message", {
      type: "CHAT",
      data: {
        channelId: room,
        senderChannelId: author,
        profile: { nickname: "viewer" },
        content: "hello",
        messageTime: 1,
      },
    });
  chat("room", "viewer");
  worker.system("connected", { sessionKey: "key" });
  worker.system("connected", { sessionKey: "key" });
  subscribe(worker);
  chat("room", "room");
  chat("other", "viewer");
  chat("room", "viewer");
  f.controller.abort();
  await task;
  assert.equal(f.messages.length, 1);
  assert.equal(f.calls.filter((p) => p.includes("/subscribe/")).length, 1);
  assert.equal(f.calls.filter((p) => p.includes("/unsubscribe/")).length, 1);
  assert.equal(f.resets, 1);
});

test("CHZZK malformed worker input fails closed and releases listeners", async () => {
  const f = fixture();
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  const worker = f.workers[0];
  worker.emit("message", { type: "SYSTEM", data: "{" });
  await task;
  assert.equal(f.states.at(-1)?.state, "permission_blocked");
  assert.equal(f.messages.length, 0);
  assert.equal(worker.listenerCount("message"), 0);
  assert.equal(worker.listenerCount("error"), 0);
  assert.equal(f.recoveries, 0);
});

test("CHZZK current subscription quota failure keeps API attribution", async () => {
  const f = fixture();
  const api = f.ports.account.api;
  f.ports.account.api = async (path) => {
    if (path.includes("/subscribe/"))
      throw new ApiQuotaError("CHZZK Session API subscribe/chat");
    return api(path);
  };
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  f.workers[0].system("connected", { sessionKey: "key" });
  await task;
  assert.deepEqual(f.states.at(-1), {
    state: "quota_blocked",
    api: "CHZZK Session API subscribe/chat",
  });
});

test("CHZZK worker error retries without retaining old message listeners", async () => {
  const f = fixture();
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  const old = f.workers[0];
  old.emit("error", Error("worker failed"));
  await flush();
  assert.equal(f.workers.length, 2);
  assert.equal(old.listenerCount("message"), 0);
  f.controller.abort();
  await task;
});

test("CHZZK ignores unknown system events with unrelated payloads", async () => {
  const f = fixture();
  const task = runChzzk(f.ports, f.controller.signal);
  await flush();
  const worker = f.workers[0];
  worker.emit("message", {
    type: "SYSTEM",
    data: { type: "unrelated", data: "opaque" },
  });
  await flush();
  assert.deepEqual(
    f.states.map((s) => s.state),
    ["connecting"],
  );
  subscribe(worker);
  assert.equal(f.states.at(-1)?.state, "subscribed");
  f.controller.abort();
  await task;
});

test("CHZZK rejects an invalid session response without opening a worker or retrying", async () => {
  const f = fixture();
  f.ports.account.api = async () => ({ url: 123 });
  await runChzzk(f.ports, f.controller.signal);
  assert.equal(f.workers.length, 0);
  assert.equal(f.recoveries, 0);
  assert.equal(f.states.at(-1)?.state, "permission_blocked");
});
