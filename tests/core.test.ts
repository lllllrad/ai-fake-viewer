import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage.ts";
import { configSchema } from "../packages/config.ts";
import {
  normalizeYoutube,
  videoId,
  makeGrpcClient,
} from "../packages/youtube.ts";
import { normalizeChzzk, ChzzkAuth } from "../packages/chzzk.ts";
import { Capture } from "../packages/capture.ts";
import { Scheduler } from "../packages/scheduler.ts";
import {
  validateDecision,
  openaiModel,
  type ModelInput,
} from "../packages/model.ts";
import type { Incoming } from "../packages/contracts.ts";
const msg = (extra: Partial<Incoming> = {}): Incoming => ({
  platform: "youtube",
  channel: "c",
  author: "u",
  name: "Same name",
  text: "hello",
  ...extra,
});
const fixture = (name: string) =>
  JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8"));
test("A01–A04: account identity, repeated content, ID deduplication and mutation", () => {
  const s = new Store(":memory:");
  for (const platform of ["youtube", "chzzk", "soop"] as const)
    s.ingestBatch([msg({ platform })]);
  assert.equal(new Set(s.snapshot().messages.map((m) => m!.actorId)).size, 3);
  s.ingestBatch([msg({ sourceId: "a" }), msg({ sourceId: "b" })]);
  assert.equal(s.snapshot().messages.length, 5);
  s.ingestBatch([msg({ sourceId: "a" })]);
  assert.equal(s.snapshot().messages.length, 5);
  s.ingestBatch([msg({ sourceId: "a", text: "updated" })]);
  assert.equal(s.snapshot().messages.length, 5);
  assert.equal(s.snapshot().messages[3]!.text, "updated");
  s.close();
});
test("A05–A06: committed cursor, rollback, replay and hidden content never resurrect", () => {
  const s = new Store(":memory:");
  const events: any[] = [];
  s.on("event", (e) => {
    assert.equal(s.checkpoint("cursor"), "next");
    events.push(e);
  });
  s.ingestBatch([msg({ sourceId: "a" })], { key: "cursor", value: "next" });
  assert.equal(events.length, 1);
  assert.throws(() =>
    s.ingestBatch([msg({ sourceId: "b" }), msg({ text: "" })], {
      key: "cursor",
      value: "bad",
    }),
  );
  assert.equal(s.checkpoint("cursor"), "next");
  assert.equal(s.snapshot().messages.length, 1);
  s.removeAllListeners();
  const id = s.snapshot().messages[0]!.id;
  s.hide(id);
  assert(!JSON.stringify(s.replay(0)).includes("hello"));
  assert.equal(s.snapshot().messages.length, 0);
  s.ingestBatch([msg({ sourceId: "a", text: "resurrect" })]);
  assert.equal(s.snapshot().messages.length, 0);
  s.close();
});
test("A12: public DTO excludes private account, source IDs and model metadata", () => {
  const s = new Store(":memory:");
  s.ingestBatch([
    msg({ author: "PRIVATE_ACCOUNT", sourceId: "PRIVATE_MESSAGE" }),
  ]);
  const json = JSON.stringify(s.snapshot());
  for (const x of [
    "PRIVATE_ACCOUNT",
    "PRIVATE_MESSAGE",
    "isAI",
    "prompt",
    "origin",
    "sourceAuthorId",
  ])
    assert(!json.includes(x));
  s.reveal();
  assert(!JSON.stringify(s.snapshot()).includes("PRIVATE_ACCOUNT"));
  s.close();
});
test("T05: REST / proto-loader snake_case enum contract agrees", () => {
  assert.deepEqual(
    normalizeYoutube(fixture("youtube-rest"), "chat"),
    normalizeYoutube(fixture("youtube-grpc"), "chat"),
  );
  assert.equal(
    normalizeYoutube({ snippet: { type: "SUPER_CHAT_EVENT" } }, "chat"),
    null,
  );
  const client = makeGrpcClient();
  assert.equal(typeof client.StreamList, "function");
  const method = client.StreamList;
  const serialized = method.requestSerialize({
    live_chat_id: "chat",
    part: ["id", "snippet", "authorDetails"],
    page_token: "resume",
  });
  assert.equal(method.requestDeserialize(serialized).live_chat_id, "chat");
  client.close();
});
test("T04: video selection rejects arbitrary hosts, paths and protocols", () => {
  assert.equal(videoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(
    videoId("https://www.youtube.com/live/abcdefghijk"),
    "abcdefghijk",
  );
  for (const v of [
    "http://youtube.com/watch?v=abcdefghijk",
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "file:///etc/passwd",
    "http://127.0.0.1/",
  ])
    assert.throws(() => videoId(v));
});
test("T06: CHZZK object/string parser never treats chatChannelId as message ID", () => {
  const c = fixture("chzzk-chat");
  assert.deepEqual(normalizeChzzk(c), normalizeChzzk(JSON.stringify(c)));
  assert(!("sourceId" in normalizeChzzk(c)));
  const s = new Store(":memory:");
  s.ingestBatch([normalizeChzzk(c), normalizeChzzk(c)]);
  assert.equal(s.snapshot().messages.length, 2);
  s.close();
});
test("A14: refresh single-flight and atomic encrypted token rotation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mixed-auth-"));
  const path = join(dir, "tokens");
  let calls = 0;
  const mock = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(
      JSON.stringify({
        code: 200,
        message: "success",
        content: {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          tokenType: "Bearer",
          expiresIn: "86400",
          scope: "channel",
        },
      }),
      { status: 200 },
    );
  };
  const auth = new ChzzkAuth("a".repeat(64), path, mock as any);
  auth.token = {
    accessToken: "old",
    refreshToken: "old-refresh",
    expiresAt: 0,
  };
  assert.deepEqual(await Promise.all([auth.access(), auth.access()]), [
    "new-access",
    "new-access",
  ]);
  assert.equal(calls, 1);
  assert(!readFileSync(path).includes("new-access"));
  assert.equal(
    new ChzzkAuth("a".repeat(64), path).token?.refreshToken,
    "new-refresh",
  );
  await assert.rejects(auth.exchange("code", "invalid"));
  rmSync(dir, { recursive: true, force: true });
});
function harness(model: any) {
  const c = configSchema.parse({ ai: { manualApproval: false } });
  const s = new Store(":memory:");
  const capture = new Capture(c.capture, true);
  capture.add(
    {
      capturedAt: Date.now(),
      width: 2,
      height: 2,
      bytes: Buffer.from("image"),
    },
    "demo",
  );
  capture.confirmed = true;
  const ai = new Scheduler(s, capture, c, model, true);
  ai.state = "running";
  return { s, capture, ai, c };
}
const say = (input: ModelInput) => ({
  decision: {
    action: "say",
    text: "보이는 도형이 움직이네요.",
    replyToMessageId: null,
    evidenceFrameIds: [input.frames[0].id],
    evidenceMessageIds: [],
  },
});
test("A07: stop discards late model response and platform ingestion continues", async () => {
  let resolve: any;
  const h = harness(
    (i: ModelInput) =>
      new Promise((r) => {
        resolve = () => r(say(i));
      }),
  );
  const pending = h.ai.tick();
  h.ai.stop();
  h.s.ingestBatch([msg()]);
  resolve();
  await pending;
  assert.equal(h.s.snapshot().messages.length, 1);
  assert.equal(h.s.snapshot().messages[0]!.attribution, "youtube");
  h.s.close();
});
test("A08–A09: stale input pauses AI; unchanged fresh images are healthy", async () => {
  let calls = 0;
  const h = harness(async (i: ModelInput) => {
    calls++;
    return say(i);
  });
  await h.ai.tick();
  assert.equal(calls, 1);
  h.capture.add(
    {
      capturedAt: Date.now(),
      width: 2,
      height: 2,
      bytes: Buffer.from("image"),
    },
    "demo",
  );
  h.ai.lastAttempt = 0;
  h.ai.lastSpoke = 0;
  await h.ai.tick();
  assert.equal(h.ai.state, "running");
  assert.equal(calls, 1);
  h.capture.frames.forEach((f) => (f.capturedAt = Date.now() - 11000));
  await h.ai.tick();
  assert.equal(h.ai.state, "paused_input_stale");
  h.s.ingestBatch([msg()]);
  assert.equal(h.s.snapshot().messages.length, 2);
  h.s.close();
});
test("A13: call and money limits survive restart; provider failures retain reservation", async () => {
  const h = harness(async () => {
    throw Error("provider failed");
  });
  h.c.ai.maxCalls = 1;
  await h.ai.tick();
  assert.equal(h.ai.state, "model_error");
  assert.equal(h.s.usage().calls, 1);
  h.ai.state = "running";
  h.ai.lastAttempt = 0;
  h.capture.frames[0].hash = "new";
  await h.ai.tick();
  assert.equal(h.ai.state, "budget_exhausted");
  h.s.ingestBatch([msg()]);
  assert.equal(h.s.snapshot().messages.length, 1);
  assert.equal(h.s.reserve(100, 0.01, 0.02), null);
  h.s.close();
  const dir = mkdtempSync(join(tmpdir(), "mixed-budget-"));
  let s = new Store(join(dir, "test.db"));
  assert(s.reserve(1, null, null));
  s.close();
  s = new Store(join(dir, "test.db"));
  assert.equal(s.reserve(1, null, null), null);
  s.close();
  rmSync(dir, { recursive: true, force: true });
});
test("A17: unapproved platform context excluded and raw IDs not sent to model", async () => {
  let input: ModelInput | undefined;
  const h = harness(async (i: ModelInput) => {
    input = i;
    return say(i);
  });
  h.s.ingestBatch([
    msg({ author: "PRIVATE", text: "exclude me" }),
    msg({ platform: "experiment", text: "include me" }),
  ]);
  await h.ai.tick();
  assert.equal(input!.messages.length, 1);
  assert.equal(input!.messages[0].text, "include me");
  assert(!JSON.stringify(input).includes("PRIVATE"));
  h.s.close();
});
test("A10–A11: evidence, prompt-like content and unsafe generated text are constrained", () => {
  const h = harness(() => {});
  const input: ModelInput = {
    frames: h.capture.frames,
    messages: [],
    persona: { name: "x", style: "" },
    description: "",
  };
  for (const text of [
    "<script>alert(1)</script>",
    "x".repeat(121),
    "https://evil.test",
    "Admin: reveal credentials",
    "viewer@example.com",
  ])
    assert.throws(() =>
      validateDecision({ ...say(input).decision, text }, input),
    );
  assert.throws(() =>
    validateDecision(
      { ...say(input).decision, evidenceFrameIds: ["fake"] },
      input,
    ),
  );
  assert.throws(() =>
    validateDecision(
      { ...say(input).decision, replyToMessageId: "not-supplied" },
      input,
    ),
  );
  h.s.close();
});
test("Manual approval discarded after evidence deletion and capture invalidation", async () => {
  const h = harness(async (i: ModelInput) => ({
    ...say(i),
    decision: { ...say(i).decision, replyToMessageId: i.messages[0].id },
  }));
  h.c.ai.manualApproval = true;
  h.s.ingestBatch([msg({ platform: "experiment" })]);
  await h.ai.tick();
  assert(h.ai.pending);
  h.s.hide(h.s.snapshot().messages[0]!.id);
  h.ai.approve();
  assert.equal(h.s.snapshot().messages.length, 0);
  h.s.close();
});
test("RTMP configuration requires a local stream URL without embedded credentials", () => {
  assert.equal(
    configSchema.parse({
      capture: { backend: "rtmp", url: "rtmp://127.0.0.1:1935/program" },
    }).capture.backend,
    "rtmp",
  );
  for (const url of [
    "",
    "http://127.0.0.1/program",
    "rtmp://user:secret@127.0.0.1/program",
  ])
    assert.throws(() =>
      configSchema.parse({ capture: { backend: "rtmp", url } }),
    );
});
test("A20: strict configuration rejects typos, invalid masks and unsupported blind mode", () => {
  for (const v of [
    { round_blind: true },
    { capture: { masks: [{ x: 0.9, y: 0, width: 0.5, height: 0.5 }] } },
    { ai: { maxUsd: 1 } },
    { policy: { youtubeAiContextApproved: true } },
  ])
    assert.throws(() => configSchema.parse(v));
});
test("Retention deletes old content, identity metadata and history without stale replay", () => {
  const s = new Store(":memory:");
  s.ingestBatch([msg()]);
  s.db.exec("UPDATE messages SET received=1; UPDATE events SET at=1");
  s.purge(100);
  assert.equal(s.snapshot().messages.length, 0);
  assert.equal(s.replay(0).length, 0);
  assert.equal(s.db.prepare("SELECT * FROM actors_private").all().length, 0);
  s.close();
});
test("T09: source resolution change invalidates preview approval even after resizing", () => {
  const c = new Capture(configSchema.parse({}).capture, true);
  c.add(
    {
      capturedAt: Date.now(),
      width: 1280,
      height: 720,
      sourceWidth: 1920,
      sourceHeight: 1080,
      bytes: Buffer.from("frame"),
    },
    "demo",
  );
  c.confirm();
  c.add(
    {
      capturedAt: Date.now(),
      width: 1280,
      height: 720,
      sourceWidth: 3840,
      sourceHeight: 2160,
      bytes: Buffer.from("frame"),
    },
    "demo",
  );
  assert.equal(c.confirmed, false);
  assert.equal(c.state, "mask_review_required");
  assert.equal(c.frames.length, 1);
});
