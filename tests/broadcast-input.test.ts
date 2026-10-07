import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { withBroadcastInput } from "../packages/infrastructure/inputs/broadcast-input.ts";
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
