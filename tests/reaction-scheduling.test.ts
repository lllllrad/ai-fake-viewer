import { test } from "node:test";
import assert from "node:assert/strict";
import { ReactionSchedule } from "../packages/application/reactions/scheduling.ts";
function fixture(failed: (error: unknown) => void = () => {}) {
  const callbacks = new Map<number, () => void>();
  const canceled: number[] = [];
  let next = 0;
  const register = (callback: () => void) => {
    const id = ++next;
    callbacks.set(id, callback);
    return id;
  };
  const schedule = new ReactionSchedule<number>(
    {
      repeat: register,
      delay: register,
      cancelRepeat: (id) => canceled.push(id),
      cancelDelay: (id) => canceled.push(id),
    },
    failed,
  );
  return { schedule, callbacks, canceled };
}
test("a stopped polling callback cannot tick a restarted schedule", () => {
  const { schedule, callbacks } = fixture();
  let ticks = 0;
  schedule.start(() => ticks++, 1000);
  const old = schedule.pollHandle!;
  schedule.start(() => ticks++, 1000);
  callbacks.get(old)!();
  assert.equal(ticks, 0);
  callbacks.get(schedule.pollHandle!)!();
  assert.equal(ticks, 1);
});
test("a superseded publication callback cannot clear or run its replacement", () => {
  const { schedule, callbacks } = fixture();
  let calls = 0;
  schedule.defer(() => calls++, 10);
  const old = schedule.dispatchHandle!;
  schedule.defer(() => calls++, 20);
  const current = schedule.dispatchHandle;
  callbacks.get(old)!();
  assert.equal(schedule.dispatchHandle, current);
  assert.equal(calls, 0);
  callbacks.get(current!)!();
  callbacks.get(current!)!();
  assert.equal(calls, 1);
  assert.equal(schedule.dispatchHandle, undefined);
});
test("stopping releases both handles and rejects already queued callbacks", () => {
  const { schedule, callbacks, canceled } = fixture();
  let calls = 0;
  schedule.start(() => calls++, 1000);
  schedule.defer(() => calls++, 10);
  schedule.stop();
  for (const callback of callbacks.values()) callback();
  assert.equal(calls, 0);
  assert.equal(schedule.pollHandle, undefined);
  assert.equal(schedule.dispatchHandle, undefined);
  assert.equal(canceled.length, 2);
});
test("publication failure stops polling before reporting and cannot escape a throwing error reporter", () => {
  let failures = 0;
  const { schedule, callbacks } = fixture(() => {
    failures++;
    assert.equal(schedule.pollHandle, undefined);
    throw Error("fixture reporter failure");
  });
  schedule.start(() => {}, 1000);
  schedule.defer(() => {
    throw Error("fixture publication failure");
  }, 10);
  assert.doesNotThrow(() => callbacks.get(schedule.dispatchHandle!)!());
  assert.equal(failures, 1);
  assert.equal(schedule.dispatchHandle, undefined);
});
test("a running publication callback can schedule its successor without losing the new handle", () => {
  const { schedule, callbacks } = fixture();
  schedule.defer(() => schedule.defer(() => {}, 20), 10);
  const old = schedule.dispatchHandle!;
  callbacks.get(old)!();
  const current = schedule.dispatchHandle;
  assert.notEqual(current, undefined);
  assert.notEqual(current, old);
  callbacks.get(old)!();
  assert.equal(schedule.dispatchHandle, current);
});
