import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ServerMaintenance,
  type MaintenanceEvent,
} from "../apps/server/maintenance.ts";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";

test("maintenance isolates each task, reports transitions and retries at its own interval", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const events: MaintenanceEvent[] = [];
  let recoveries = 0,
    purges = 0;
  let recoveryFails = true,
    purgeFails = true;
  const owner = new ServerMaintenance({
    recover: () => {
      recoveries++;
      if (recoveryFails) throw new Error("sensitive recovery fixture");
    },
    purge: () => {
      purges++;
      if (purgeFails) throw new Error("sensitive storage fixture");
    },
    report: (event) => {
      events.push(event);
    },
  });
  t.after(() => owner.stop());
  owner.start();
  owner.start();
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  assert.equal(recoveries, 2);
  assert.equal(purges, 0);
  assert.deepEqual(events, [{ task: "ai_recovery", state: "failed" }]);
  recoveryFails = false;
  t.mock.timers.tick(1000);
  assert.deepEqual(events.at(-1), { task: "ai_recovery", state: "recovered" });
  t.mock.timers.tick(3600000);
  assert.equal(purges, 1);
  assert.deepEqual(events.at(-1), { task: "retention", state: "failed" });
  t.mock.timers.tick(3600000);
  assert.equal(purges, 2);
  assert.equal(events.length, 3);
  purgeFails = false;
  t.mock.timers.tick(3600000);
  assert.deepEqual(events.at(-1), { task: "retention", state: "recovered" });
  assert.equal(events.length, 4);
  assert(!JSON.stringify(events).includes("sensitive"));
  owner.stop();
  owner.start();
  const count = recoveries;
  t.mock.timers.tick(3600000);
  assert.equal(recoveries, count);
  assert.equal(purges, 3);
});

test("a failing maintenance reporter cannot escape the timer or stop retries", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0,
    reports = 0;
  const owner = new ServerMaintenance({
    purge: () => {},
    recover: () => {
      if (++calls === 1) throw new Error("fixture");
    },
    report: () => {
      reports++;
      throw new Error("logger fixture");
    },
  });
  t.after(() => owner.stop());
  owner.start();
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  assert.equal(calls, 3);
  assert.equal(reports, 2);
});

test("reentrant shutdown suppresses task completion reports and all later callbacks", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const events: MaintenanceEvent[] = [];
  const owner = new ServerMaintenance({
    purge: () => {},
    recover: () => {
      calls++;
      owner.stop();
      throw new Error("retired fixture");
    },
    report: (event) => {
      events.push(event);
    },
  });
  owner.start();
  t.mock.timers.tick(1000);
  t.mock.timers.tick(3600000);
  assert.equal(calls, 1);
  assert.deepEqual(events, []);
});

test("the HTTP server survives a recovery read failure and cancels maintenance before closing storage", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const dir = mkdtempSync(join(tmpdir(), "server-maintenance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs: string[] = [];
  t.mock.method(console, "error", (message: string) => {
    logs.push(message);
  });
  const env = await createApp(configSchema.parse({}), {
    demo: true,
    startInputs: false,
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
  });
  t.after(() => env.app.close());
  let reads = 0;
  t.mock.method(env.store, "aiDesiredRunning", () => {
    if (++reads === 1) throw new Error("private database details");
    return false;
  });
  t.mock.timers.tick(1000);
  assert.equal(
    (
      await env.app.inject({
        url: "/health",
        headers: { host: "127.0.0.1:3210" },
      })
    ).statusCode,
    200,
  );
  t.mock.timers.tick(1000);
  assert.deepEqual(
    logs.map((entry) => JSON.parse(entry)),
    [
      { type: "server_maintenance", task: "ai_recovery", state: "failed" },
      { type: "server_maintenance", task: "ai_recovery", state: "recovered" },
    ],
  );
  await env.app.close();
  const afterClose = reads;
  t.mock.timers.tick(3600000);
  assert.equal(reads, afterClose);
  assert.throws(() => env.store.db.prepare("SELECT 1"));
});
