import { test } from "node:test";
import assert from "node:assert/strict";
import { limitModelConcurrency } from "../packages/application/reactions/model-concurrency.ts";
const signal = () => new AbortController().signal;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function fixture(maximum = 1) {
  const started: number[] = [],
    releases = new Map<number, (result: number) => void>();
  const model = limitModelConcurrency((input: number) => {
    started.push(input);
    return new Promise<number>((resolve) => releases.set(input, resolve));
  }, maximum);
  return { model, started, releases };
}
test("model slots obey their cap and release queued calls in FIFO order", async () => {
  const { model, started, releases } = fixture(2);
  const calls = [1, 2, 3, 4].map((input) => model(input, signal()));
  await flush();
  assert.deepEqual(started, [1, 2]);
  releases.get(2)!(20);
  assert.equal(await calls[1], 20);
  await flush();
  assert.deepEqual(started, [1, 2, 3]);
  releases.get(1)!(10);
  assert.equal(await calls[0], 10);
  await flush();
  assert.deepEqual(started, [1, 2, 3, 4]);
  releases.get(3)!(30);
  releases.get(4)!(40);
  assert.deepEqual(await Promise.all(calls), [10, 20, 30, 40]);
});
test("queued cancellation removes only that waiter and never invokes the model", async () => {
  const { model, started, releases } = fixture();
  const first = model(1, signal()),
    controller = new AbortController();
  const canceled = model(2, controller.signal),
    third = model(3, signal());
  const rejection = assert.rejects(canceled, /fixture cancellation/);
  controller.abort(Error("fixture cancellation"));
  await rejection;
  await flush();
  assert.deepEqual(started, [1]);
  releases.get(1)!(1);
  await first;
  await flush();
  assert.deepEqual(started, [1, 3]);
  releases.get(3)!(3);
  await third;
});
test("canceling an active transport does not overbook its slot before it settles", async () => {
  const { model, started, releases } = fixture();
  const controller = new AbortController();
  const first = model(1, controller.signal),
    second = model(2, signal());
  await flush();
  controller.abort();
  await flush();
  assert.deepEqual(started, [1]);
  releases.get(1)!(1);
  await first;
  await flush();
  assert.deepEqual(started, [1, 2]);
  releases.get(2)!(2);
  await second;
});
test("synchronous provider exceptions release capacity for the next call", async () => {
  const calls: number[] = [];
  const model = limitModelConcurrency((input: number) => {
    calls.push(input);
    if (input === 1) throw Error("fixture provider failure");
    return Promise.resolve(input);
  }, 1);
  const failed = model(1, signal()),
    next = model(2, signal());
  await assert.rejects(failed, /fixture provider failure/);
  assert.equal(await next, 2);
  assert.deepEqual(calls, [1, 2]);
});
test("already canceled requests never occupy a slot", async () => {
  let calls = 0;
  const model = limitModelConcurrency(async (input: number) => {
    calls++;
    return input;
  }, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model(1, controller.signal), { name: "AbortError" });
  assert.equal(await model(2, signal()), 2);
  assert.equal(calls, 1);
});
test("invalid concurrency values fail before constructing a deadlocked queue", () => {
  for (const maximum of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(
      () => limitModelConcurrency(async (input: number) => input, maximum),
      /positive safe integer/,
    );
});
