import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewSession } from "../apps/web/src/features/workspace/preview-session.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function urls() {
  const created: string[] = [],
    revoked: string[] = [];
  return {
    created,
    revoked,
    create: (_blob: Blob) => {
      const url = `blob:fixture-${created.length}`;
      created.push(url);
      return url;
    },
    revoke: (url: string) => {
      revoked.push(url);
    },
  };
}

test("preview polling waits for completion and repeated starts cannot overlap requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = deferred<Blob>(),
    resources = urls();
  const signals: AbortSignal[] = [];
  const owner = new PreviewSession((signal) => {
    signals.push(signal);
    return response.promise;
  }, resources);
  t.after(() => owner.stop());
  owner.start();
  owner.start();
  t.mock.timers.tick(10_000);
  assert.equal(signals.length, 1);
  response.resolve(new Blob(["fixture"]));
  await flush();
  assert.equal(owner.snapshot(), "blob:fixture-0");
  t.mock.timers.tick(1999);
  assert.equal(signals.length, 1);
  t.mock.timers.tick(1);
  assert.equal(signals.length, 2);
  owner.stop();
  assert(signals[1].aborted);
  await flush();
  t.mock.timers.tick(10_000);
  assert.equal(signals.length, 2);
  assert.equal(owner.snapshot(), "");
  assert.deepEqual(resources.created, resources.revoked);
});

for (const outcome of ["resolved", "rejected"] as const) {
  test(`a ${outcome} retired preview cannot replace or clear the new lifetime`, async (t) => {
    const old = deferred<Blob>(),
      current = deferred<Blob>(),
      resources = urls();
    const signals: AbortSignal[] = [];
    const owner = new PreviewSession((signal) => {
      signals.push(signal);
      return signals.length === 1 ? old.promise : current.promise;
    }, resources);
    t.after(() => owner.stop());
    owner.start();
    owner.stop();
    assert(signals[0].aborted);
    owner.start();
    current.resolve(new Blob(["new fixture"]));
    await flush();
    const image = owner.snapshot();
    if (outcome === "resolved") old.resolve(new Blob(["old fixture"]));
    else old.reject(new Error("Retired request failure"));
    await flush();
    assert.equal(owner.snapshot(), image);
    assert.equal(resources.created.length, 1);
    assert.equal(resources.revoked.length, 0);
    owner.stop();
    owner.stop();
    assert.deepEqual(resources.created, resources.revoked);
  });
}

test("a failed current request clears its image and a later success can recover", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const resources = urls();
  const owner = new PreviewSession(async () => {
    if (++calls === 2) throw new Error("Fixture unavailable");
    return new Blob(["fixture"]);
  }, resources);
  t.after(() => owner.stop());
  const snapshots: string[] = [];
  const unsubscribe = owner.subscribe(() => snapshots.push(owner.snapshot()));
  owner.start();
  await flush();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(owner.snapshot(), "");
  assert.deepEqual(resources.revoked, ["blob:fixture-0"]);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(owner.snapshot(), "blob:fixture-1");
  assert.deepEqual(snapshots, ["blob:fixture-0", "", "blob:fixture-1"]);
  unsubscribe();
  owner.stop();
  assert.equal(snapshots.length, 3);
  assert.deepEqual(resources.created, resources.revoked);
});
