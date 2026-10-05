import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";

test("broadcast end turns off AI and clears its restart intent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-end-"));
  const { app, store, scheduler, supervisor } = await createApp(
    configSchema.parse({
      database: ":memory:",
      ai: { visualMode: "on_request" },
    }),
    {
      demo: true,
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(directory, "chatgpt.tokens"),
      chzzkTokenPath: join(directory, "chzzk.tokens"),
      soopTokenPath: join(directory, "soop.tokens"),
    },
  );
  try {
    scheduler.state = "running";
    store.setAiDesiredRunning(true);
    supervisor.status("youtube", "ended");
    assert.equal(scheduler.state, "broadcast_ended");
    assert.equal(store.aiDesiredRunning(), false);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("global AI toggle arms the live persona and reveal disarms it with persisted status", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-controls-"));
  const { app, store, scheduler, personas } = await createApp(
    configSchema.parse({
      database: ":memory:",
      ai: { visualMode: "on_request" },
    }),
    {
      demo: true,
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(directory, "chatgpt.tokens"),
      chzzkTokenPath: join(directory, "chzzk.tokens"),
      soopTokenPath: join(directory, "soop.tokens"),
    },
  );
  const headers = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"a".repeat(64)}`,
  };
  try {
    const persona = personas.createBrief({
      session_title: "Fixture",
      topic: "Fixture",
      audience_intent: "Observe",
      public_context: "",
      private_production_context: "",
      tone_policy: "Brief",
      candidate_count: 1,
      cast_size: 1,
    });
    // Isolate the control path from authoring/model calls.
    store.db
      .prepare("UPDATE persona_sessions SET state='live' WHERE id=?")
      .run(persona.id);
    let response = await app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(store.personaRuntime()?.armed, true);
    assert.equal(store.aiDesiredRunning(), true);
    response = await app.inject({
      method: "POST",
      url: "/api/admin/reveal",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(scheduler.state, "stopped");
    assert.equal(store.personaRuntime()?.armed, false);
    assert.equal(store.aiDesiredRunning(), false);
    response = await app.inject({
      method: "GET",
      url: "/api/admin/status",
      headers,
    });
    assert.equal(response.json().originsRevealed, true);
    assert.ok(Math.abs(response.json().generatedAt - Date.now()) < 1000);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live readiness and saved-intent recovery do not require programConfirmed", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-no-confirm-flag-"));
  const oldGroqKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture-only-not-a-real-key";
  const { app, store, scheduler, capture, transcriber, resumeAiIfRequested } =
    await createApp(
      configSchema.parse({
        database: ":memory:",
        capture: { masks: [{ x: 0, y: 0, width: 0.5, height: 1 }] },
        audio: { url: "rtmp://127.0.0.1/fixture" },
      }),
      {
        startInputs: false,
        adminToken: "a".repeat(64),
        readerToken: "r".repeat(64),
        encryptionKey: "e".repeat(64),
        chatgptTokenPath: join(directory, "chatgpt.tokens"),
        chzzkTokenPath: join(directory, "chzzk.tokens"),
        soopTokenPath: join(directory, "soop.tokens"),
      },
    );
  // Exercise real start checks without capture workers or provider requests.
  t.mock.method(scheduler, "providerReady", () => true);
  t.mock.method(scheduler, "tick", async () => {});
  const headers = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"a".repeat(64)}`,
  };
  try {
    transcriber.state = "listening";
    capture.add(
      {
        capturedAt: Date.now(),
        width: 100,
        height: 100,
        bytes: Buffer.from("fixture"),
      },
      "obs_program",
    );
    let response = await app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers,
    });
    assert.equal(
      response.statusCode,
      409,
      "A runtime preview check is still required",
    );
    capture.confirm();
    response = await app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(scheduler.state, "running");
    scheduler.stop("server_shutdown", true);
    capture.confirmed = false;
    assert.equal(resumeAiIfRequested(), true);
    assert.equal(capture.confirmed, true);
    assert.equal(store.aiDesiredRunning(), true);
    scheduler.stop("server_shutdown", true);
    capture.frames[0].capturedAt = Date.now() - 11000;
    assert.equal(resumeAiIfRequested(), false, "Stale video cannot resume AI");
  } finally {
    await app.close();
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldGroqKey;
    rmSync(directory, { recursive: true, force: true });
  }
});
