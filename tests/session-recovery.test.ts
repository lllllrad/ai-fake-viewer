import { syntheticMessage } from "./helpers/message.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../packages/storage.ts";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";

test("broadcast state survives abrupt process exit; end deletes it and remains closed after restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "broadcast-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.sqlite");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {Store} from './packages/storage.ts';
    let now=Date.now(); Date.now=()=>now;
    const s=new Store(process.argv[1],true);
    s.ingestBatch([{platform:'experiment',channel:'fixture',author:'fixture',name:'Fixture',text:'RECOVERY_PRIVATE_RAW'}]);
    s.recordTranscript({id:'speech',text:'RECOVERY_PRIVATE_SPEECH',capturedAt:now});
    s.setAiDesiredRunning(true);
    process.exit(0);
  `,
      path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  let store = new Store(path, true);
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(store.transcriptCount(), 1);
  assert.equal(store.aiDesiredRunning(), true);
  if (process.platform !== "win32")
    assert.equal(statSync(path).mode & 0o777, 0o600);
  store.purge(Date.now() + 86400000);
  assert.equal(store.snapshot().messages.length, 1);
  store.closeSession();
  store.close();
  store = new Store(path, true);
  assert.equal(store.closed(), true);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.transcriptCount(), 0);
  assert.equal(store.aiDesiredRunning(), false);
  assert.equal(
    readFileSync(path).includes(Buffer.from("RECOVERY_PRIVATE")),
    false,
  );
  store.newSession();
  assert.equal(store.closed(), false);
  store.close();
});

test("live app restores enabled AI after readiness returns; explicit stop remains stopped", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ai-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = configSchema.parse({
    database: join(dir, "session.sqlite"),
    ai: { visualMode: "on_request" },
  });
  const options = {
    startInputs: false,
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
  };
  let env = await createApp(config, options);
  env.scheduler.readyCheck = () => [];
  env.scheduler.providerReady = () => true;
  env.scheduler.model = async () => {
    throw Error("No model request expected without evidence");
  };
  env.scheduler.start();
  const cast = env.store.personaRuntime()!.id,
    session = env.store.sessionId;
  await env.app.close();
  env = await createApp(config, options);
  assert.equal(env.store.sessionId, session);
  assert.equal(env.store.aiDesiredRunning(), true);
  env.scheduler.readyCheck = () => ["fixture missing input"];
  assert.equal(env.resumeAiIfRequested(), false);
  assert.equal(env.store.aiDesiredRunning(), true);
  assert.equal(env.scheduler.state, "waiting_restart_inputs");
  env.scheduler.readyCheck = () => [];
  env.scheduler.providerReady = () => true;
  assert.equal(env.resumeAiIfRequested(), true);
  assert.equal(env.scheduler.state, "running");
  assert.equal(env.store.personaRuntime()!.id, cast);
  env.scheduler.stop();
  await env.app.close();
  env = await createApp(config, options);
  assert.equal(env.store.aiDesiredRunning(), false);
  assert.equal(env.resumeAiIfRequested(), false);
  await env.app.close();
});
