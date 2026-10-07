import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerShutdown } from "../apps/server/shutdown.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("server shutdown cancels work immediately and drains inputs before closing storage once", async () => {
  const events: string[] = [];
  const input = deferred();
  let reentrant: Promise<void> | undefined;
  const shutdown = new ServerShutdown({
    cancelTimers: () => {
      events.push("timers");
      reentrant = shutdown.close();
    },
    cancelAuthoring: () => {
      events.push("authoring");
    },
    shutdownBroadcast: () => {
      events.push("inputs");
      return input.promise;
    },
    closeReaders: () => {
      events.push("readers");
    },
    closeBroadcastStorage: () => {
      events.push("broadcast-storage");
    },
  });
  const closing = shutdown.close();
  assert.equal(reentrant, closing);
  assert.equal(shutdown.close(), closing);
  assert.deepEqual(events, ["timers", "authoring", "inputs"]);
  input.resolve();
  await closing;
  await shutdown.close();
  assert.deepEqual(events, [
    "timers",
    "authoring",
    "inputs",
    "readers",
    "broadcast-storage",
  ]);
});

test("each failed cleanup is reported after every resource has been attempted", async () => {
  const events: string[] = [];
  const fail = (name: string) => {
    events.push(name);
    throw new Error(name);
  };
  const shutdown = new ServerShutdown({
    cancelTimers: () => fail("timers"),
    cancelAuthoring: () => fail("authoring"),
    shutdownBroadcast: async () => fail("inputs"),
    closeReaders: () => fail("readers"),
    closeBroadcastStorage: () => fail("broadcast-storage"),
  });
  const closing = shutdown.close();
  await assert.rejects(closing, (error: unknown) => {
    assert(error instanceof AggregateError);
    assert.deepEqual(
      error.errors.map((entry: Error) => entry.message),
      events,
    );
    assert.equal(error.errors.length, 5);
    return true;
  });
  assert.equal(shutdown.close(), closing);
  assert.deepEqual(events, [
    "timers",
    "authoring",
    "inputs",
    "readers",
    "broadcast-storage",
  ]);
});

test("the HTTP app reports storage failure after stopping generation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "server-shutdown-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = await createApp(configSchema.parse({}), {
    demo: true,
    startInputs: false,
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
  });
  t.after(() => env.app.close().catch(() => {}));
  const closeStore = env.store.close.bind(env.store);
  t.mock.method(env.store, "close", () => {
    closeStore();
    throw new Error("Fixture storage close failure");
  });
  await assert.rejects(env.app.close(), /Server resource shutdown failed/);
  assert.equal(env.scheduler.state, "server_shutdown");
  assert.throws(() => env.store.db.prepare("SELECT 1"));
});
