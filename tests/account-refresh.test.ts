import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountRefresh } from "../packages/application/accounts/refresh-flight.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("refresh ownership is published before work and shared until completion", async () => {
  const owner = new AccountRefresh<string>(),
    result = deferred<string>();
  let nested: Promise<string> | undefined;
  const first = owner.run(() => {
    nested = owner.run(async () => assert.fail("Duplicate refresh"));
    return result.promise;
  });
  assert.equal(first, nested);
  result.resolve("fixture");
  assert.equal(await first, "fixture");
  assert.equal(owner.pending, undefined);
});

test("a retired refresh cannot return credentials or release the replacement", async () => {
  const owner = new AccountRefresh<string>(),
    old = deferred<string>(),
    fresh = deferred<string>();
  const first = owner.run(() => old.promise);
  const rejected = assert.rejects(first, /Account refresh changed/);
  owner.invalidate();
  const second = owner.run(() => fresh.promise);
  old.resolve("retired");
  await rejected;
  assert.equal(owner.pending, second);
  assert.equal(
    owner.run(async () => assert.fail("Duplicate replacement")),
    second,
  );
  fresh.resolve("current");
  assert.equal(await second, "current");
  assert.equal(owner.pending, undefined);
});

test("synchronous refresh failure releases ownership and remains retryable", async () => {
  const owner = new AccountRefresh<string>();
  await assert.rejects(
    owner.run(() => {
      throw new Error("Fixture failure");
    }),
    /Fixture failure/,
  );
  assert.equal(owner.pending, undefined);
  assert.equal(await owner.run(async () => "retry"), "retry");
});
