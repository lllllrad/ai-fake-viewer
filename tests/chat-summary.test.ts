import { PersonaService } from "../packages/persona/service.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import { Scheduler } from "../packages/infrastructure/reactions/scheduler.ts";
import { configSchema } from "../packages/config.ts";
import {
  modelMessages,
  type Model,
  type ModelInput,
} from "../packages/model.ts";
import type { Incoming } from "../packages/contracts.ts";

const msg = (author: string, text: string): Incoming => ({
  platform: "youtube",
  channel: "c",
  author,
  name: `PRIVATE_NAME_${author}`,
  text,
});
function add(store: Store, author: string, text: string) {
  store.grantConsent("youtube", "c", author);
  store.ingestBatch([msg(author, text)]);
}
function fixture(model: Model, reviewDraft = false) {
  const config = configSchema.parse({
    database: ":memory:",
    ai: { provider: "openai_api", manualApproval: true, reviewDraft },
  });
  const store = new Store(":memory:");
  const capture = new Capture(config.capture, true);
  capture.add(
    { bytes: Buffer.from("test"), capturedAt: Date.now(), width: 2, height: 2 },
    "demo",
  );
  const scheduler = new Scheduler(
    store,
    capture,
    config,
    model,
    false,
    () => true,
  );
  scheduler.state = "running";
  add(store, "a", "PRIVATE_ORIGINAL 코드 오류가 왜 나나요?");
  return { store, capture, scheduler, config };
}
const say = (input: ModelInput) => ({
  decision: {
    action: "say" as const,
    text: "화면이 바뀌었네요",
    replyToMessageId: null,
    evidenceFrameIds: [input.frames.at(-1)!.id],
    evidenceMessageIds: [],
    evidenceTranscriptIds: [],
  },
});

test("summary emits only fixed shared labels, never names, originals or one-person opinions", () => {
  const store = new Store(":memory:");
  for (let i = 0; i < 8; i++) add(store, "a", "PRIVATE_SECRET 코딩 오류? ㅋㅋ");
  assert.equal(store.chatSummary().state, "insufficient_data");
  add(store, "b", "코드 오류?");
  add(store, "c", "코딩 버그?");
  const summary = store.chatSummary();
  assert.deepEqual(summary.topics, ["개발·기술"]);
  assert.deepEqual(summary.atmosphere, ["질문이 오감"]);
  assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
  const persisted = JSON.stringify(
    store.db.prepare("SELECT payload FROM chat_context_summaries").all(),
  );
  assert.equal(persisted.includes("PRIVATE"), false);
  const payload = JSON.stringify(
    modelMessages({
      frames: [],
      messages: [],
      persona: { name: "p", style: "s" },
      description: "broadcast",
      chatSummary: summary,
    }),
  );
  assert.match(payload, /anonymousChatSummary/);
  store.ingestBatch([msg("a", "!철회")]);
  assert.equal(store.chatSummary().state, "insufficient_data");
  assert.equal(
    JSON.stringify(store.context(["youtube"])).includes("PRIVATE_ORIGINAL"),
    false,
  );
  assert.equal(
    (
      store.db
        .prepare("SELECT text FROM messages WHERE hidden=1 LIMIT 1")
        .get() as any
    ).text,
    "",
  );
  store.grantConsent("youtube", "c", "a");
  assert.equal(store.chatSummary().state, "insufficient_data");
  store.close();
});

test("summary clear survives restart, uses only later messages and expires with its window", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-summary-"));
  let store = new Store(join(dir, "db.sqlite"));
  try {
    for (const author of ["a", "b", "c"]) add(store, author, "게임 화이팅!");
    assert.equal(store.chatSummary().state, "available");
    store.clearChatSummary();
    store.close();
    store = new Store(join(dir, "db.sqlite"));
    assert.equal(store.chatSummary().state, "insufficient_data");
    for (const author of ["a", "b", "c"]) add(store, author, "실험 신기하다");
    assert.deepEqual(store.chatSummary().topics, ["제작·실험"]);
    assert.equal(
      store.chatSummary(Date.now() + 120001).state,
      "insufficient_data",
    );
    store.newSession();
    assert.equal(store.chatSummary().state, "insufficient_data");
    store.deleteAll();
    assert.equal(
      (
        store.db
          .prepare("SELECT COUNT(*) n FROM chat_context_summaries")
          .get() as any
      ).n,
      0,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const phase of ["generation", "review"] as const)
  test(`withdrawal aborts ${phase} and discards even a response citing only unrelated video`, async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let signalSeen: AbortSignal | undefined;
    let inputSeen: ModelInput | undefined;
    let calls = 0;
    const h = fixture(async (input, signal) => {
      calls++;
      if (phase === "generation" || calls === 2) {
        signalSeen = signal;
        inputSeen = input;
        entered();
        await waiting;
      }
      return say(input);
    }, phase === "review");
    try {
      const work = h.scheduler.tick();
      await ready;
      h.store.ingestBatch([msg("a", "!철회")]);
      assert.equal(signalSeen?.aborted, true);
      assert.deepEqual(inputSeen?.messages, []);
      assert.equal(inputSeen?.reviewDraft, undefined);
      assert.equal(h.scheduler.processedMessageVersions.size, 0);
      release();
      await work;
      assert.equal(h.scheduler.pending, undefined);
      assert.equal(h.store.snapshot().messages.length, 0);
      assert.equal(h.scheduler.state, "running");
    } finally {
      release();
      h.scheduler.stop();
      h.store.close();
    }
  });

test("withdrawal clears manual candidate and retracts dependent AI messages transitively", async () => {
  const h = fixture(async (input) => say(input));
  try {
    await h.scheduler.tick();
    assert.ok(h.scheduler.pending);
    h.scheduler.approve();
    const first = h.store
      .snapshot()
      .messages.find((m) => m?.attribution === "experiment")!;
    assert.ok(first);
    h.store.ingestBatch([
      {
        platform: "experiment",
        channel: h.store.sessionId,
        author: "second",
        name: "Second",
        text: "derived copy",
      },
    ]);
    const second = h.store.snapshot().messages.at(-1)!;
    h.store.recordAiContext(second.id, [first.id]);
    h.scheduler.lastAttempt = 0;
    h.capture.add(
      {
        bytes: Buffer.from("next"),
        capturedAt: Date.now(),
        width: 2,
        height: 2,
      },
      "demo",
    );
    h.scheduler.personaTimes = [];
    await h.scheduler.tick();
    assert.ok(h.scheduler.pending);
    h.store.ingestBatch([msg("a", "!철회")]);
    assert.equal(h.scheduler.pending, undefined);
    assert.equal(h.store.publicMessage(first.id), null);
    assert.equal(h.store.publicMessage(second.id), null);
    h.scheduler.approve();
    assert.equal(h.store.snapshot().messages.length, 0);
  } finally {
    h.scheduler.stop();
    h.store.close();
  }
});

test("failed ingestion does not broadcast withdrawal or invalidate valid context", () => {
  const store = new Store(":memory:");
  add(store, "a", "keep this text");
  let events = 0;
  store.on("context_invalidated", () => events++);
  store.on("event", () => events++);
  assert.throws(() => store.ingestBatch([msg("a", "!철회"), msg("b", "")]));
  assert.equal(events, 0);
  assert.equal(store.context(["youtube"])[0].text, "keep this text");
  store.close();
});

test("withdrawal erases persisted persona output and manifest, including published paraphrases", async (t) => {
  const h = fixture(async (input) => ({
    ...say(input),
    decision: { ...say(input).decision, text: "PRIVATE_ORIGINAL" },
  }));
  try {
    const service = new PersonaService(h.store, undefined, h.config);
    const session = service.ensureAutomaticCast();
    service.arm(session.id, session.control_epoch);
    add(h.store, "a", "PRIVATE_ORIGINAL 새 코드 오류?");
    h.capture.add(
      {
        bytes: Buffer.from("after join"),
        capturedAt: Date.now(),
        width: 2,
        height: 2,
      },
      "demo",
    );
    t.mock.method(Math, "random", () => 0);
    await h.scheduler.tick();
    assert.ok(h.scheduler.pending?.attemptId);
    const canceledId = h.scheduler.pending.attemptId;
    h.store.clearChatSummary();
    assert.equal(h.scheduler.pending, undefined);
    assert.equal(
      (
        h.store.db
          .prepare("SELECT state FROM persona_reaction_attempts WHERE id=?")
          .get(canceledId) as any
      ).state,
      "canceled",
    );
    await h.scheduler.tick();
    assert.equal(h.scheduler.pending, undefined);
    add(h.store, "a", "PRIVATE_ORIGINAL 다음 코드 질문?");
    h.scheduler.lastAttempt = 0;
    await h.scheduler.tick();
    const candidate = h.scheduler.pending as Scheduler["pending"];
    assert.ok(candidate?.attemptId);
    const attemptId = candidate.attemptId;
    candidate.notBefore = 0;
    h.scheduler.approve();
    const published = h.store
      .snapshot()
      .messages.find((m) => m?.attribution === "experiment")!;
    assert.ok(published);
    h.store.ingestBatch([msg("a", "!철회")]);
    const attempt = h.store.db
      .prepare(
        "SELECT result,model_manifest,event_ids FROM persona_reaction_attempts WHERE id=?",
      )
      .get(attemptId) as any;
    assert.equal(attempt.result, null);
    assert.equal(attempt.model_manifest, null);
    assert.equal(attempt.event_ids, "[]");
    assert.equal(h.store.publicMessage(published.id), null);
    assert.equal(
      JSON.stringify(h.store.context(["experiment", "youtube"])).includes(
        "PRIVATE_ORIGINAL",
      ),
      false,
    );
  } finally {
    h.scheduler.stop();
    h.store.close();
  }
});
