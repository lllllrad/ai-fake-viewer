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
import type { Model } from "../packages/model.ts";

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
