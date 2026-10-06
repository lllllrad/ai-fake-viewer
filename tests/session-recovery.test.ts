import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/participation.ts";
import { NoticeBot } from "../packages/notice-bot.ts";
import {
  approvedProfile,
  activateFixture,
  privacyMessage,
} from "./privacy-fixtures.ts";
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
    import {Participation} from './packages/participation.ts';
    import {approvedProfile,activateFixture,privacyMessage} from './tests/privacy-fixtures.ts';
    let now=Date.now(); Date.now=()=>now;
    const p=new Participation(approvedProfile(),''), s=new Store(process.argv[1],p);
    activateFixture(s,'viewer',ms=>now+=ms);
    s.ingestBatch([privacyMessage('viewer','RECOVERY_PRIVATE_RAW',++now)]);
    s.ingestBatch([privacyMessage('waiting','ordinary',++now)]);
    p.delivered(p.get('youtube','fixture','waiting').id);
    s.recordTranscript({id:'speech',text:'RECOVERY_PRIVATE_SPEECH',capturedAt:now});
    s.setAiDesiredRunning(true);
    s.setConsentNoticeEnabled('youtube',true);
    process.exit(0);
  `,
      path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const p = new Participation(approvedProfile(), "");
  let store = new Store(path, p);
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(p.get("youtube", "fixture", "viewer")?.state, "ACTIVE");
  assert.notEqual(p.get("youtube", "fixture", "waiting")?.deliveredAt, null);
  assert.equal(store.transcriptCount(), 1);
  assert.equal(store.aiDesiredRunning(), true);
  assert.equal(store.consentNoticeEnabled("youtube"), true);
  if (process.platform !== "win32")
    assert.equal(statSync(path).mode & 0o777, 0o600);
  store.purge(Date.now() + 86400000);
  assert.equal(store.snapshot().messages.length, 1);
  store.closeSession();
  store.close();
  store = new Store(path, new Participation(approvedProfile(), ""));
  assert.equal(store.closed(), true);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.participation!.participants.size, 0);
  assert.equal(store.transcriptCount(), 0);
  assert.equal(store.aiDesiredRunning(), false);
  assert.equal(
    readFileSync(path).includes(Buffer.from("RECOVERY_PRIVATE")),
    false,
  );
  store.newSession();
  assert.equal(store.closed(), false);
  assert.equal(store.participation!.ended, false);
  store.close();
});

test("one confirmed notice covers observed viewers only, survives restart, and still requires individual consent", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "shared-notice-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const path = join(dir, "session.sqlite");
  let p = new Participation(approvedProfile(), ""),
    store = new Store(path, p);
  const send = (author: string, text: string, platform = "youtube") =>
    store.ingestBatch([
      privacyMessage(author, text, ++now, { platform: platform as any }),
    ]);
  send("absent", "old activity");
  now += 301000;
  send("a", "hello");
  send("b", "hello");
  send("other-platform", "hello", "chzzk");
  const bot = new NoticeBot(p, "fixture", "youtube"),
    notice = bot.next(true)!;
  // Oldest target also receives the notice; recently observed a and b share it.
  ++now;
  assert(bot.echo("fixture", notice.text));
  assert.notEqual(p.get("youtube", "fixture", "a")!.deliveredAt, null);
  assert.notEqual(p.get("youtube", "fixture", "b")!.deliveredAt, null);
  assert.equal(p.get("chzzk", "fixture", "other-platform")!.deliveredAt, null);
  assert.equal(p.get("youtube", "fixture", "a")!.state, "WAITING_CONSENT");
  assert.equal(bot.next(true), null);
  send("a", "!동의");
  send("a", "accepted after consent");
  send("b", "still not consented");
  assert.equal(store.snapshot().messages.length, 1);
  store.close();
  p = new Participation(approvedProfile(), "");
  store = new Store(path, p);
  const recovered = new NoticeBot(p, "fixture", "youtube");
  assert.equal(recovered.next(true), null);
  send("b", "!동의");
  assert.equal(p.get("youtube", "fixture", "b")!.state, "ACTIVE");
  send("new-arrival", "hello");
  assert(recovered.next(true));
  send("fixture", "broadcaster");
  assert.equal(p.get("youtube", "fixture", "fixture"), undefined);
  send("a", "!철회");
  assert.equal(store.snapshot().messages.length, 0);
  store.close();
  p = new Participation(approvedProfile(), "");
  store = new Store(path, p);
  assert.equal(p.get("youtube", "fixture", "a")!.state, "WITHDRAWN");
  assert.equal(store.snapshot().messages.length, 0);
  store.close();
});

test("live app restores enabled AI after readiness returns; explicit stop remains stopped", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ai-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = configSchema.parse({
    database: join(dir, "session.sqlite"),
    privacy: approvedProfile(),
    ai: { visualMode: "on_request" },
  });
  const options = {
    startInputs: false,
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
    youtubeTokenPath: join(dir, "youtube"),
    chzzkTokenPath: join(dir, "chzzk"),
    soopTokenPath: join(dir, "soop"),
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

test("shared notice does not cover inactive viewers or silently change the saved consent profile", (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const dir = mkdtempSync(join(tmpdir(), "notice-scope-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.sqlite"),
    profile = approvedProfile();
  const p = new Participation(profile, ""),
    store = new Store(path, p);
  store.ingestBatch([privacyMessage("inactive", "hello", ++now)]);
  now += 301000;
  store.ingestBatch([privacyMessage("present", "hello", ++now)]);
  const target = p.get("youtube", "fixture", "present")!;
  p.noticeDelivered("youtube", "fixture", ++now, target.id);
  assert.equal(p.get("youtube", "fixture", "inactive")!.deliveredAt, null);
  assert.equal(target.deliveredAt, now);
  const incompatible = approvedProfile();
  incompatible.noticeVersion = "unacknowledged-change";
  assert.throws(
    () => new Store(path, new Participation(incompatible, "")),
    /Saved broadcast consent/,
  );
  store.closeSession();
  store.close();
  const changed = approvedProfile();
  changed.noticeVersion = "next-broadcast";
  const reopened = new Store(path, new Participation(changed, ""));
  assert.equal(reopened.closed(), true);
  reopened.newSession();
  assert.equal(
    reopened.participation!.fingerprint,
    new Participation(changed, "").fingerprint,
  );
  reopened.close();
});
