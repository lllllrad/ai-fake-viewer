import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NoticeDeliverySession,
  type NoticeDeliveryPort,
} from "../packages/application/participation/notice-delivery-session.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(tick: NoticeDeliveryPort["tick"] = async () => {}) {
  const controller = new AbortController();
  const callbacks: (() => void)[] = [];
  const canceled: number[] = [];
  const errors: unknown[] = [];
  let resets = 0;
  const sender = {
    tick,
    reset: () => {
      resets++;
    },
  };
  const clock = {
    repeat: (callback: () => void, ms: number) => {
      assert.equal(ms, 1000);
      return callbacks.push(callback) - 1;
    },
    cancel: (handle: number) => {
      canceled.push(handle);
    },
  };
  const start = () =>
    new NoticeDeliverySession(sender, controller.signal, clock, (error) => {
      errors.push(error);
    });
  return {
    controller,
    callbacks,
    canceled,
    errors,
    sender,
    clock,
    start,
    get resets() {
      return resets;
    },
  };
}

test("notice delivery never overlaps requests and continues after successful settlement", async () => {
  const pending = deferred();
  let calls = 0;
  const f = fixture(() => {
    calls++;
    return pending.promise;
  });
  const session = f.start();
  f.callbacks[0]();
  f.callbacks[0]();
  await flush();
  f.callbacks[0]();
  assert.equal(calls, 1);
  pending.resolve();
  await flush();
  f.callbacks[0]();
  await flush();
  assert.equal(calls, 2);
  await session.stop();
});

test("notice delivery stops queued callbacks before invoking a sender", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
  });
  const session = f.start();
  f.callbacks[0]();
  await session.stop();
  f.callbacks[0]();
  await flush();
  assert.equal(calls, 0);
  assert.deepEqual(f.canceled, [0]);
  assert.equal(f.resets, 1);
});

test("notice delivery aborts and resets before draining an active request", async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  const f = fixture((received) => {
    signal = received;
    return pending.promise;
  });
  const session = f.start();
  f.callbacks[0]();
  await flush();
  let stopped = false;
  const drain = session.stop().then(() => {
    stopped = true;
  });
  assert.equal(signal?.aborted, true);
  assert.equal(f.resets, 1);
  await flush();
  assert.equal(stopped, false);
  pending.resolve();
  await drain;
  await session.stop();
  assert.equal(f.resets, 1);
});

test("notice delivery parent abort immediately retires polling and ignores late failure", async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const session = f.start();
  f.callbacks[0]();
  await flush();
  f.controller.abort();
  assert.equal(f.resets, 1);
  assert.deepEqual(f.canceled, [0]);
  pending.reject(Error("late write failure"));
  await session.stop();
  assert.deepEqual(f.errors, []);
});

for (const synchronous of [true, false]) {
  test(`unexpected notice failure retires polling and reports once: synchronous=${synchronous}`, async () => {
    const failure = Error("storage failure");
    let calls = 0;
    const f = fixture(() => {
      calls++;
      if (synchronous) throw failure;
      return Promise.reject(failure);
    });
    const session = f.start();
    f.callbacks[0]();
    await flush();
    f.callbacks[0]();
    await session.stop();
    assert.equal(calls, 1);
    assert.deepEqual(f.errors, [failure]);
    assert.equal(f.resets, 1);
  });
}

test("already aborted notice delivery does not create a timer", async () => {
  const f = fixture();
  f.controller.abort();
  await f.start().stop();
  assert.deepEqual(f.callbacks, []);
  assert.equal(f.resets, 1);
});

test("notice cleanup and diagnostic failures cannot leave polling active", async () => {
  const f = fixture(async () => {
    throw Error("failure");
  });
  f.sender.reset = () => {
    throw Error("reset failure");
  };
  const session = new NoticeDeliverySession(
    f.sender,
    f.controller.signal,
    f.clock,
    () => {
      throw Error("diagnostic failure");
    },
  );
  f.callbacks[0]();
  await flush();
  await session.stop();
  assert.deepEqual(f.canceled, [0]);
});

test("timer setup failure resets the notice sender and is reported", async () => {
  const f = fixture();
  const failure = Error("timer unavailable");
  f.clock.repeat = () => {
    throw failure;
  };
  await f.start().stop();
  assert.deepEqual(f.errors, [failure]);
  assert.equal(f.resets, 1);
});
