import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusSession } from "../apps/web/src/features/workspace/status-session.ts";
import { AdminRequestError } from "../apps/web/src/lib/admin-client.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a late pre-refresh response cannot overwrite a newer status", async () => {
  const first = deferred<number>(),
    second = deferred<number>();
  const signals: AbortSignal[] = [];
  const owner = new StatusSession((signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  });
  try {
    owner.start();
    const refresh = owner.refresh();
    assert(signals[0]!.aborted);
    second.resolve(2);
    await refresh;
    first.resolve(1);
    await flush();
    assert.equal(owner.snapshot().data, 2);
  } finally {
    owner.stop();
  }
});

test("sign-out invalidates in-flight reads even when the transport ignores cancellation", async () => {
  const request = deferred<number>();
  const owner = new StatusSession(() => request.promise);
  owner.start();
  owner.signOut();
  request.resolve(1);
  await flush();
  assert.deepEqual(owner.snapshot(), {
    phase: "signed_out",
    failed: false,
    error: "",
  });
  owner.stop();
});

test("network failure preserves stale data; authentication failure erases it", async () => {
  let result: number | Error = 1;
  const owner = new StatusSession(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  try {
    owner.start();
    await flush();
    assert.equal(owner.snapshot().phase, "signed_in");
    result = new AdminRequestError("Fixture unavailable", 503);
    await owner.refresh();
    assert.equal(owner.snapshot().data, 1);
    assert.equal(owner.snapshot().failed, true);
    result = new AdminRequestError("Fixture expired", 401);
    await owner.refresh();
    assert.equal(owner.snapshot().phase, "signed_out");
    assert.equal(owner.snapshot().data, undefined);
    result = 2;
    await owner.refresh();
    assert.equal(owner.snapshot().phase, "signed_in");
    assert.equal(owner.snapshot().data, 2);
  } finally {
    owner.stop();
  }
});

test("initial service failure is recoverable unavailability rather than an authentication decision", async () => {
  const owner = new StatusSession(async () => {
    throw new AdminRequestError("Fixture unavailable", 503);
  });
  try {
    owner.start();
    await flush();
    assert.equal(owner.snapshot().phase, "unavailable");
    assert.equal(owner.snapshot().failed, true);
  } finally {
    owner.stop();
  }
});

test("polling waits for completion and stop cancels its timer and request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<number>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const owner = new StatusSession((s) => {
    calls++;
    signal = s;
    return calls === 1 ? pending.promise : Promise.resolve(2);
  }, 2000);
  owner.start();
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  pending.resolve(1);
  await flush();
  t.mock.timers.tick(1999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(calls, 2);
  await flush();
  owner.stop();
  assert(signal!.aborted);
  t.mock.timers.tick(10000);
  assert.equal(calls, 2);
});
