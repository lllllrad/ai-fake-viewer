import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage.ts";
import { configSchema } from "../packages/config.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import { Scheduler } from "../packages/infrastructure/reactions/scheduler.ts";
import { validateDecision } from "../packages/application/reactions/validate-decision.ts";
import { openaiModel } from "../packages/infrastructure/reactions/responses-api.ts";
import { type ModelInput } from "../packages/application/reactions/model-port.ts";
import type { Incoming } from "../packages/contracts/incoming.ts";
const msg = (extra: Partial<Incoming> = {}): Incoming => ({
  platform: "experiment",
  channel: "c",
  author: "u",
  name: "Same name",
  text: "hello",
  ...extra,
});
const fixture = (name: string) =>
  JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8"));
const consent = (s: Store, m: Incoming = msg()) =>
  test("AI desired running state survives a database-backed server restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-running-state-"));
    const path = join(dir, "state.sqlite");
    const first = new Store(path);
    first.setAiDesiredRunning(true);
    first.close();
    const restarted = new Store(path);
    assert.equal(restarted.aiDesiredRunning(), true);
    restarted.setAiDesiredRunning(false);
    restarted.close();
    rmSync(dir, { recursive: true, force: true });
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
  const ai = new Scheduler(s, capture, c, model, true);
  ai.state = "running";
  return { s, capture, ai, c };
}
const say = (input: ModelInput<Buffer>) => ({
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
    (i: ModelInput<Buffer>) =>
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
  assert.equal(h.s.snapshot().messages[0]!.attribution, "experiment");
  h.s.close();
});
test("A08–A09: stale input pauses AI; unchanged fresh images are healthy", async () => {
  let calls = 0;
  const h = harness(async (i: ModelInput<Buffer>) => {
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
test("A13: legacy call limits are ignored; money limits and usage survive restart", async () => {
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
  assert.equal(h.ai.state, "model_error");
  assert.equal(h.s.usage().calls, 2);
  h.s.ingestBatch([msg()]);
  assert.equal(h.s.snapshot().messages.length, 1);
  assert.equal(h.s.reserve(0.01, 0.02), null);
  h.s.close();
  const dir = mkdtempSync(join(tmpdir(), "mixed-budget-"));
  let s = new Store(join(dir, "test.db"));
  assert(s.reserve(0.5, 0.5));
  s.close();
  s = new Store(join(dir, "test.db"));
  assert.equal(s.reserve(0.5, 0.5), null);
  s.close();
  rmSync(dir, { recursive: true, force: true });
});
test("A10–A11: evidence, prompt-like content and unsafe generated text are constrained", () => {
  const h = harness(() => {});
  const input: ModelInput<Buffer> = {
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
  const h = harness(async (i: ModelInput<Buffer>) => ({
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
    "http://127.0.0.1/program",
    "rtmp://user:secret@127.0.0.1/program",
  ])
    assert.throws(() => configSchema.parse({ input: { streamUrl: url } }));
});
test("A20: strict configuration rejects typos, invalid masks and unsupported blind mode", () => {
  for (const v of [
    { round_blind: true },
    { capture: { masks: [{ x: 0.9, y: 0, width: 0.5, height: 0.5 }] } },
    { ai: { maxUsd: 1 } },
    { policy: { obsolete: true } },
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
test("T09: source resolution change clears old frames and continues receiving", () => {
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
  assert.equal(c.state, "demo");
  assert.equal(c.frames.length, 1);
});

test("publication drops a candidate citing frames removed by source resolution change", async () => {
  const h = harness(async (input: ModelInput<Buffer>) => say(input));
  h.c.ai.manualApproval = true;
  try {
    await h.ai.tick();
    assert.ok(h.ai.pending);
    const oldFrame = h.capture.latest()!.id;
    h.capture.add(
      {
        capturedAt: Date.now(),
        width: 4,
        height: 4,
        bytes: Buffer.from("new frame"),
      },
      "demo",
    );
    assert.equal(h.capture.has(oldFrame), false);
    assert.equal(h.capture.state, "demo");
    h.ai.approve();
    assert.equal(h.s.snapshot().messages.length, 0);
  } finally {
    h.ai.stop();
    h.s.close();
  }
});
