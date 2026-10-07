import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";

test("broadcast end turns off AI and clears its restart intent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-end-"));
  const { app, store, scheduler, broadcast } = await createApp(
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
    },
  );
  try {
    scheduler.state = "running";
    store.setAiDesiredRunning(true);
    await broadcast.endBroadcast();
    assert.equal(scheduler.state, "broadcast_ended");
    assert.equal(store.aiDesiredRunning(), false);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("global AI toggle arms the live persona and reveal disarms it with persisted status", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-controls-"));
  const { app, store, scheduler, capture, transcriber } = await createApp(
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
    },
  );
  const headers = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"a".repeat(64)}`,
  };
  try {
    let response = await app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(store.personaRuntime()?.armed, true);
    assert.equal(store.aiDesiredRunning(), true);
    const videoStop = t.mock.method(capture, "stop", () => {});
    const audioStop = t.mock.method(transcriber, "stop", () => {});
    response = await app.inject({
      method: "POST",
      url: "/api/admin/ai/stop",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(store.aiDesiredRunning(), false);
    assert.equal(store.personaRuntime()?.armed, false);
    assert.equal(videoStop.mock.callCount(), 0);
    assert.equal(audioStop.mock.callCount(), 0);
    response = await app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers,
    });
    assert.equal(response.statusCode, 200);
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

test("missing dedicated stream blocks AI and never restores running intent", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "privacy-start-"));
  const env = await createApp(
    configSchema.parse({
      database: ":memory:",
      ai: { provider: "openai_api" },
    }),
    {
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(directory, "chatgpt"),
    },
  );
  try {
    t.mock.method(env.scheduler, "providerReady", () => true);
    const response = await env.app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers: {
        host: "127.0.0.1:3210",
        authorization: `Bearer ${"a".repeat(64)}`,
      },
    });
    assert.equal(response.statusCode, 409);
    env.store.setAiDesiredRunning(true);
    assert.equal(env.resumeAiIfRequested(), false);
    env.capture.start();
    env.transcriber.start();
    assert.equal(env.capture.allowProcessing(), true);
    assert.notEqual(env.capture.state, "session_closed");
    assert.equal(env.transcriber.allowProcessing(), true);
    assert.equal(env.transcriber.state, "config_required");
  } finally {
    await env.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
