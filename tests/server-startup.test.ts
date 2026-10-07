import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeServer, launchServer } from "../apps/server/startup.ts";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";
import { Store } from "../packages/storage.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import { Transcriber } from "../packages/infrastructure/inputs/speech-input.ts";

test("failed composition awaits all acquired resources in reverse order and retains the cause", async () => {
  const events: string[] = [];
  const cause = new Error("initialization fixture");
  const cleanupFailure = new Error("cleanup fixture");
  await assert.rejects(
    initializeServer(async (startup) => {
      startup.add(() => {
        events.push("first");
      });
      startup.add(async () => {
        await Promise.resolve();
        events.push("second");
        throw cleanupFailure;
      });
      startup.add(() => {
        events.push("third");
      });
      throw cause;
    }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.cause, cause);
      assert.deepEqual(error.errors, [cause, cleanupFailure]);
      return true;
    },
  );
  assert.deepEqual(events, ["third", "second", "first"]);
});

test("shutdown handoff prevents duplicate resource cleanup on a later startup failure", async () => {
  const events: string[] = [];
  const cause = new Error("input startup fixture");
  await assert.rejects(
    initializeServer(async (startup) => {
      startup.add(() => {
        events.push("partial");
      });
      startup.handoff(async () => {
        events.push("shutdown");
      });
      throw cause;
    }),
    (error) => error === cause,
  );
  assert.deepEqual(events, ["shutdown"]);
});

test("successful composition leaves resource lifetime to the returned server", async () => {
  let closed = false;
  const server = {};
  assert.equal(
    await initializeServer(async (startup) => {
      startup.add(() => {
        closed = true;
      });
      return server;
    }),
    server,
  );
  assert.equal(closed, false);
});

function options(dir: string) {
  return {
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
  };
}

test("input startup failure stops started capture and closes each database exactly once", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "server-startup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let capture: Capture | undefined;
  const start = Capture.prototype.start;
  t.mock.method(Capture.prototype, "start", function (this: Capture) {
    capture = this;
    start.call(this);
  });
  const cause = new Error("speech startup fixture");
  t.mock.method(Transcriber.prototype, "start", () => {
    throw cause;
  });
  let storeCloses = 0;
  const closeStore = Store.prototype.close;
  t.mock.method(Store.prototype, "close", function (this: Store) {
    storeCloses++;
    closeStore.call(this);
  });
  await assert.rejects(
    createApp(configSchema.parse({}), {
      ...options(dir),
      demo: true,
    }),
    (error) => error === cause,
  );
  assert(capture);
  assert.equal(capture.timer, undefined);
  assert.equal(capture.state, "stopped");
  assert.equal(storeCloses, 1);
});

test("listen failure skips input startup and preserves both start and cleanup errors", async () => {
  const events: string[] = [];
  const cause = new Error("port fixture");
  const cleanup = new Error("close fixture");
  await assert.rejects(
    launchServer({
      listen: async () => {
        events.push("listen");
        throw cause;
      },
      startInputs: () => {
        events.push("inputs");
      },
      close: async () => {
        events.push("close");
        throw cleanup;
      },
    }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.cause, cause);
      assert.deepEqual(error.errors, [cause, cleanup]);
      return true;
    },
  );
  assert.deepEqual(events, ["listen", "close"]);
});

test("input failure after listening closes the socket, capture and storage", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "server-launch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = await createApp(configSchema.parse({}), {
    ...options(dir),
    demo: true,
    startInputs: false,
  });
  t.after(() => env.app.close());
  const cause = new Error("input launch fixture");
  let listeningAtInputStart = false;
  t.mock.method(env.transcriber, "start", () => {
    listeningAtInputStart = env.app.server.listening;
    assert(env.capture.timer);
    throw cause;
  });
  await assert.rejects(
    launchServer({
      listen: () => env.app.listen({ host: "127.0.0.1", port: 0 }),
      startInputs: () => env.broadcast.startInputs(),
      close: () => env.app.close(),
    }),
    (error) => error === cause,
  );
  assert.equal(listeningAtInputStart, true);
  assert.equal(env.app.server.listening, false);
  assert.equal(env.capture.timer, undefined);
  assert.equal(env.capture.state, "stopped");
  assert.throws(() => env.store.db.prepare("SELECT 1"));
});

test("successful launch leaves the listening server owned by normal shutdown", async () => {
  const events: string[] = [];
  await launchServer({
    listen: async () => {
      events.push("listen");
    },
    startInputs: () => {
      events.push("inputs");
    },
    close: async () => {
      events.push("close");
    },
  });
  assert.deepEqual(events, ["listen", "inputs"]);
});
