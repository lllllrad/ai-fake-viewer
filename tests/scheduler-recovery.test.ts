import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage.ts";
import { Scheduler } from "../packages/scheduler.ts";
import { Capture } from "../packages/capture.ts";
import { configSchema } from "../packages/config.ts";
import { PersonaService } from "../packages/persona/service.ts";
import type { Transcriber } from "../packages/transcription.ts";
import { modelMessages, type Model } from "../packages/model.ts";

const skipped = {
  action: "skip" as const,
  text: null,
  replyToMessageId: null,
  evidenceFrameIds: [],
  evidenceMessageIds: [],
  evidenceTranscriptIds: [],
};

test("successive speech contexts with unchanged chat sequence create independent persona attempts", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  const config = configSchema.parse({ ai: { visualMode: "on_request" } });
  const store = new Store(":memory:");
  const service = new PersonaService(store, undefined, config);
  const session = service.ensureAutomaticCast();
  service.arm(session.id, session.control_epoch);
  let transcript = {
    id: "speech-1",
    capturedAt: ++now,
    text: "Synthetic speech",
  };
  let calls = 0;
  const model: Model = async () => {
    calls++;
    return { decision: skipped };
  };
  const transcriber = {
    recent: () => [transcript],
    has: (id: string) => id === transcript.id,
  } as Transcriber;
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    model,
    false,
    () => true,
    transcriber,
  );
  scheduler.state = "running";
  const seq = store.lastSeq();
  try {
    await scheduler.tick(now);
    assert.equal(calls, 1);
    now += 40000;
    transcript = { ...transcript, id: "speech-2", capturedAt: now };
    await scheduler.tick(now);
    assert.equal(calls, 2);
    assert.equal(store.lastSeq(), seq);
    assert.equal(scheduler.state, "running");
    const attempts = store.db
      .prepare(
        "SELECT member_id,context_cutoff,context_key FROM persona_reaction_attempts",
      )
      .all() as any[];
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].member_id, attempts[1].member_id);
    assert.equal(attempts[0].context_cutoff, attempts[1].context_cutoff);
    assert.notEqual(attempts[0].context_key, attempts[1].context_key);
    await scheduler.tick(now);
    assert.equal(calls, 2);
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("scheduler preparation errors stop AI instead of escaping a fire-and-forget timer", async (t) => {
  const config = configSchema.parse({ ai: { visualMode: "on_request" } }),
    store = new Store(":memory:");
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    async () => ({ decision: skipped }),
    false,
    () => true,
  );
  t.mock.method(store, "snapshot", () => {
    throw Error("Synthetic SQLite preparation failure");
  });
  try {
    scheduler.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduler.state, "scheduler_error");
    assert.equal(scheduler.timer, undefined);
    assert.equal(store.aiDesiredRunning(), false);
    assert.equal(scheduler.busy, false);
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("attempt context reservations are idempotent and legacy sequence-only tables migrate", () => {
  const dir = mkdtempSync(join(tmpdir(), "attempt-context-")),
    path = join(dir, "fixture.sqlite");
  let store = new Store(path);
  const attempt = {
    id: "a",
    sessionId: "s",
    memberId: "m",
    eventIds: ["speech-1"],
    cutoff: 0,
    sessionEpoch: 0,
    memberEpoch: 0,
    definitionHash: "fixture",
    configRevision: 0,
  };
  try {
    assert.equal(store.beginPersonaAttempt(attempt), true);
    assert.equal(
      store.beginPersonaAttempt({ ...attempt, id: "duplicate" }),
      false,
    );
    const row = store.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='persona_reaction_attempts'",
      )
      .get() as { sql: string };
    const old = row.sql
      .replace("persona_reaction_attempts", "old_attempts")
      .replace("context_key TEXT NOT NULL,", "")
      .replace(
        "UNIQUE(session_id,member_id,context_key)",
        "UNIQUE(session_id,member_id,context_cutoff)",
      );
    store.db.exec(old);
    const columns = (
      store.db
        .prepare("PRAGMA table_info(persona_reaction_attempts)")
        .all() as any[]
    )
      .map((c) => c.name)
      .filter((n) => n !== "context_key")
      .join(",");
    store.db.exec(
      `INSERT INTO old_attempts SELECT ${columns} FROM persona_reaction_attempts; DROP TABLE persona_reaction_attempts; ALTER TABLE old_attempts RENAME TO persona_reaction_attempts;`,
    );
    store.close();
    store = new Store(path);
    assert.equal(
      store.beginPersonaAttempt({
        ...attempt,
        id: "b",
        eventIds: ["speech-2"],
      }),
      true,
    );
    assert.equal(
      (
        store.db
          .prepare("SELECT COUNT(*) n FROM persona_reaction_attempts")
          .get() as any
      ).n,
      2,
    );
  } finally {
    try {
      store.close();
    } catch {
      /* Reopen failure may leave the prior handle closed. */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const recoverable of ["stale", "invalid", "timeout"] as const) {
  test(`${recoverable} generation failure does not switch off AI before its retry limit`, async (t) => {
    const { StaleModelContextError } =
      await import("../packages/model-errors.ts");
    let now = Date.now(),
      calls = 0;
    t.mock.method(Math, "random", () => 0);
    t.mock.method(Date, "now", () => now);
    const config = configSchema.parse({
        ai: { visualMode: "on_request", reviewDraft: false },
      }),
      store = new Store(":memory:");
    let transcript = { id: "first", text: "Synthetic speech", capturedAt: now };
    const transcriber = {
      recent: () => [transcript],
      has: (id: string) => id === transcript.id,
    } as Transcriber;
    const model: Model = async () => {
      calls++;
      if (recoverable === "timeout")
        throw new DOMException("Synthetic timeout", "TimeoutError");
      if (calls === 1)
        throw recoverable === "stale"
          ? new StaleModelContextError()
          : Error("Invalid evidence");
      return { decision: skipped };
    };
    const scheduler = new Scheduler(
      store,
      new Capture(config.capture, false),
      config,
      model,
      false,
      () => true,
      transcriber,
    );
    scheduler.state = "running";
    store.setAiDesiredRunning(true);
    try {
      await scheduler.tick(now);
      assert.equal(calls, 1);
      assert.equal(scheduler.state, "running");
      assert.equal(store.aiDesiredRunning(), true);
      assert.equal(scheduler.lastIssue?.continuing, true);
      now += 40000;
      transcript = { ...transcript, id: "second", capturedAt: now };
      await scheduler.tick(now);
      assert.equal(calls, 2);
      assert.equal(scheduler.state, "running");
      if (recoverable === "timeout") {
        now += 40000;
        transcript = { ...transcript, id: "third", capturedAt: now };
        await scheduler.tick(now);
        assert.equal(scheduler.state, "model_error");
        assert.equal(scheduler.lastIssue?.continuing, false);
        assert.equal(store.aiDesiredRunning(), false);
      } else assert.equal(scheduler.lastIssue, undefined);
    } finally {
      scheduler.stop();
      store.close();
    }
  });
}

for (const [expireEvidence, reviewSkip] of [
  [false, false],
  [true, false],
  [false, true],
]) {
  test(`review handles rolling transcript expiry (cited evidence expired: ${expireEvidence}, review skip: ${reviewSkip})`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    t.mock.method(Math, "random", () => 0);
    const config = configSchema.parse({
      ai: { visualMode: "on_request", reviewDraft: true },
    });
    const store = new Store(":memory:");
    const background = {
      id: "background",
      text: "Earlier unrelated speech",
      capturedAt: now - 5000,
    };
    const fresh = {
      id: "fresh",
      text: "한 번 더 도전할까요?",
      capturedAt: now,
    };
    let evidence = [background, fresh];
    const transcriber = {
      recent: () => evidence,
      has: (id: string) => evidence.some((t) => t.id === id),
    } as Transcriber;
    let calls = 0;
    const model: Model = async (input) => {
      calls++;
      if (calls === 1) {
        now += 2000;
        evidence = expireEvidence ? [] : [fresh];
      } else {
        assert.deepEqual(
          input.transcripts?.map((t) => t.id),
          ["fresh"],
        );
        assert.deepEqual(
          input.newTranscripts?.map((t) => t.id),
          ["fresh"],
        );
        assert.equal(input.reviewDraft, "한 번 더 도전해 봐요.");
        if (reviewSkip) return { decision: skipped };
      }
      return {
        decision: {
          action: "say",
          text: "한 번 더 도전해 봐요.",
          replyToMessageId: null,
          evidenceMessageIds: [],
          evidenceFrameIds: [],
          evidenceTranscriptIds: ["fresh"],
        },
      };
    };
    const scheduler = new Scheduler(
      store,
      new Capture(config.capture, false),
      config,
      model,
      false,
      () => true,
      transcriber,
    );
    scheduler.state = "running";
    try {
      await scheduler.tick(now);
      assert.equal(calls, expireEvidence ? 1 : 2);
      assert.equal(
        store.snapshot().messages.length,
        expireEvidence || reviewSkip ? 0 : 1,
      );
      const events = scheduler.diagnostics.map((d) => d.event);
      assert(
        events.includes(
          expireEvidence
            ? "attempt_error"
            : reviewSkip
              ? "review_rejected"
              : "published",
        ),
      );
      assert(!JSON.stringify(scheduler.diagnostics).includes(fresh.text));
      assert(!JSON.stringify(scheduler.diagnostics).includes(background.text));
      assert.equal(
        scheduler.lastIssue?.code,
        expireEvidence ? "stale_context" : undefined,
      );
      assert.equal(scheduler.state, "running");
    } finally {
      scheduler.stop();
      store.close();
    }
  });
}

test("questions received during pacing remain new alongside later narration", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  const config = configSchema.parse({
    ai: {
      visualMode: "on_request",
      pacing: { minSeconds: 20, maxSeconds: 20 },
      reviewDraft: false,
    },
  });
  const store = new Store(":memory:");
  const service = new PersonaService(store, undefined, config);
  const session = service.ensureAutomaticCast();
  service.arm(session.id, session.control_epoch);
  let evidence = [
    { id: "question", text: "화면의 글자를 읽어 주세요.", capturedAt: ++now },
  ];
  const transcriber = {
    recent: () => evidence,
    has: (id: string) => evidence.some((t) => t.id === id),
  } as Transcriber;
  let calls = 0;
  const model: Model = async (input) => {
    calls++;
    assert.deepEqual(
      input.newTranscripts?.map((t) => t.id),
      ["question", "later"],
    );
    return { decision: skipped };
  };
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    model,
    false,
    () => true,
    transcriber,
  );
  scheduler.state = "running";
  scheduler.lastAttempt = now + 20000;
  try {
    await scheduler.tick(now);
    assert.equal(calls, 0);
    now += 30000;
    evidence.push({
      id: "later",
      text: "조금 기다려 볼게요.",
      capturedAt: now,
    });
    await scheduler.tick(now);
    assert.equal(calls, 1);
    now += 30000;
    await scheduler.tick(now);
    assert.equal(calls, 1);
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("generation and review receive the latest ten transcript chunks", async (t) => {
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  const config = configSchema.parse({
    ai: { visualMode: "on_request", reviewDraft: true },
  });
  const store = new Store(":memory:");
  const chunks = Array.from({ length: 12 }, (_, i) => ({
    id: `chunk-${i}`,
    text: `Synthetic chunk ${i}`,
    capturedAt: now - (11 - i) * 10000,
  }));
  const transcriber = {
    recent: () => chunks,
    has: (id: string) => chunks.some((t) => t.id === id),
  } as Transcriber;
  let calls = 0;
  const model: Model = async (input) => {
    calls++;
    assert.deepEqual(
      input.transcripts?.map((t) => t.id),
      chunks.slice(-10).map((t) => t.id),
    );
    assert.equal(!!input.reviewDraft, calls === 2);
    return {
      decision: {
        action: "say",
        text: "확인했어요.",
        replyToMessageId: null,
        evidenceFrameIds: [],
        evidenceMessageIds: [],
        evidenceTranscriptIds: ["chunk-11"],
      },
    };
  };
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    model,
    false,
    () => true,
    transcriber,
  );
  scheduler.state = "running";
  try {
    await scheduler.tick(now);
    assert.equal(calls, 2);
    assert.equal(scheduler.lastInput.contextTranscripts, 10);
    assert.equal(store.snapshot().messages.length, 1);
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("an edited platform message is new evidence even when its source identifier is unchanged", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const config = configSchema.parse({
    ai: {
      visualMode: "on_request",
      reviewDraft: false,
      pacing: { minSeconds: 20, maxSeconds: 20 },
    },
  });
  const store = new Store(":memory:");
  const inputs: string[] = [];
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    async (input) => {
      inputs.push(input.newMessages!.at(-1)!.text);
      return { decision: skipped };
    },
    false,
    () => true,
  );
  scheduler.state = "running";
  const message = {
    platform: "youtube" as const,
    channel: "fixture",
    author: "viewer",
    name: "Viewer",
    sourceId: "same-source",
    text: "SYNTHETIC_FIRST",
  };
  try {
    store.grantConsent(message.platform, message.channel, message.author);
    store.ingestBatch([message]);
    await scheduler.tick(now);
    assert.deepEqual(inputs, ["SYNTHETIC_FIRST"]);
    now += 21000;
    store.ingestBatch([{ ...message, text: "SYNTHETIC_EDITED" }]);
    await scheduler.tick(now);
    assert.deepEqual(inputs, ["SYNTHETIC_FIRST", "SYNTHETIC_EDITED"]);
    assert.match(scheduler.lastHash, /^[a-f0-9]{64}$/);
    now += 21000;
    await scheduler.tick(now);
    assert.equal(inputs.length, 2);
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("a late transcript chunk remains new even when a newer chunk was already processed", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const config = configSchema.parse({
    ai: {
      visualMode: "on_request",
      reviewDraft: false,
      pacing: { minSeconds: 20, maxSeconds: 20 },
    },
  });
  const chunks = [{ id: "latest", text: "latest speech", capturedAt: now }];
  const transcriber = {
    recent: () => chunks,
    has: (id: string) => chunks.some((chunk) => chunk.id === id),
  } as Transcriber;
  const store = new Store(":memory:");
  const inputs: string[][] = [];
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    async (input) => {
      inputs.push(input.newTranscripts!.map((chunk) => chunk.id));
      return { decision: skipped };
    },
    false,
    () => true,
    transcriber,
  );
  scheduler.state = "running";
  try {
    await scheduler.tick(now);
    now += 21000;
    chunks.push({
      id: "late",
      text: "delayed speech",
      capturedAt: now - 22000,
    });
    await scheduler.tick(now);
    assert.deepEqual(inputs, [["latest"], ["late"]]);
  } finally {
    scheduler.stop();
    store.close();
  }
});
