import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { withBroadcastInput } from "../packages/infrastructure/inputs/broadcast-input.ts";
import { runChzzkReceiver } from "../packages/infrastructure/platforms/chzzk-receiver.ts";
import { Store } from "../packages/storage.ts";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

for (const boundary of ["new", "close"] as const) {
  test(`broadcast input cancels an idle operation on ${boundary} and releases listeners`, async (t) => {
    const store = new Store(":memory:");
    t.after(() => store.close());
    const resetCount = store.listenerCount("reset"),
      eventCount = store.listenerCount("event");
    const running = withBroadcastInput(
      store,
      new AbortController().signal,
      (scope) =>
        new Promise<void>((resolve) => {
          scope.signal.addEventListener(
            "abort",
            () => {
              assert.equal(scope.current(), false);
              resolve();
            },
            { once: true },
          );
        }),
    );
    if (boundary === "new") store.newSession();
    else store.closeSession();
    await running;
    assert.equal(store.listenerCount("reset"), resetCount);
    assert.equal(store.listenerCount("event"), eventCount);
  });
}

test("broadcast input ignores unrelated resets and inherits parent cancellation", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const controller = new AbortController();
  await withBroadcastInput(store, controller.signal, async (scope) => {
    store.emit("reset");
    store.emit("event", { type: "message.created" });
    assert.equal(scope.signal.aborted, false);
    controller.abort();
    assert.equal(scope.signal.aborted, true);
    assert.equal(scope.current(), true);
  });
});

test("broadcast input rejects already closed ownership and cleans up thrown operations", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.closeSession();
  const resetCount = store.listenerCount("reset"),
    eventCount = store.listenerCount("event");
  await assert.rejects(
    withBroadcastInput(store, new AbortController().signal, async (scope) => {
      assert.equal(scope.signal.aborted, true);
      throw Error("operation failed");
    }),
    { message: "operation failed" },
  );
  assert.equal(store.listenerCount("reset"), resetCount);
  assert.equal(store.listenerCount("event"), eventCount);
});

class Worker extends EventEmitter {
  killed = 0;
  send() {
    return true;
  }
  kill() {
    this.killed++;
    this.emit("exit", 0);
    return true;
  }
}
function chzzkFixture(store: Store) {
  const worker = new Worker(),
    states: string[] = [],
    calls: string[] = [];
  const controller = new AbortController();
  const account = {
    access: async () => "token",
    api: async (path: string) => {
      calls.push(path);
      return { url: "https://fixture.nchat.naver.com/socket" };
    },
  };
  let workers = 0;
  const run = () =>
    runChzzkReceiver(store, account, controller.signal, {
      worker: () => {
        workers++;
        return worker as unknown as ChildProcess;
      },
      status: (state) => {
        states.push(state);
      },
      recovered: () => {},
    });
  return {
    worker,
    states,
    calls,
    controller,
    account,
    run,
    get workers() {
      return workers;
    },
  };
}

test("CHZZK active worker is retired when a new broadcast begins", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const f = chzzkFixture(store);
  let ingestions = 0;
  t.mock.method(store.ingestion, "ingest", () => {
    ingestions++;
  });
  const running = f.run();
  await flush();
  f.worker.emit("message", {
    type: "SYSTEM",
    data: {
      type: "subscribed",
      data: { eventType: "CHAT", channelId: "room" },
    },
  });
  const queued = f.worker.listeners("message")[0];
  store.newSession();
  await running;
  queued({
    type: "CHAT",
    data: {
      channelId: "room",
      senderChannelId: "viewer",
      profile: { nickname: "viewer" },
      content: "late",
      messageTime: 1,
    },
  });
  assert.equal(ingestions, 0);
  assert(f.worker.killed > 0);
  assert.equal(f.worker.listenerCount("message"), 0);
  assert.deepEqual(f.states, ["connecting", "subscribed"]);
});

test("CHZZK late account refresh cannot create a connection for a replaced broadcast", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const f = chzzkFixture(store),
    token = deferred<string>();
  f.account.access = () => token.promise;
  const running = f.run();
  store.newSession();
  token.resolve("token");
  await running;
  assert.equal(f.workers, 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.states, ["connecting"]);
});

test("CHZZK current broadcast admits normalized messages including its owner and stops cleanly", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const f = chzzkFixture(store);
  let ingestions = 0;
  t.mock.method(store.ingestion, "ingest", () => {
    ingestions++;
  });
  const running = f.run();
  await flush();
  f.worker.emit("message", {
    type: "SYSTEM",
    data: {
      type: "subscribed",
      data: { eventType: "CHAT", channelId: "room" },
    },
  });
  for (const author of ["viewer", "room"])
    f.worker.emit("message", {
      type: "CHAT",
      data: {
        channelId: "room",
        senderChannelId: author,
        profile: { nickname: "viewer" },
        content: "hello",
        messageTime: 1,
      },
    });
  assert.equal(ingestions, 2);
  f.controller.abort();
  await running;
  assert.equal(store.listenerCount("reset"), 1); // Store owns its derived-state invalidation listener.
});
