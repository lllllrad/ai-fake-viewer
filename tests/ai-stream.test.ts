import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";
import { privacyMessage } from "./privacy-fixtures.ts";
import { fixtureToolModel } from "../packages/infrastructure/experiments/models.ts";

const admin = "a".repeat(64);
async function fixture(url = "rtmp://127.0.0.1:1935/live/synthetic-ai") {
  const dir = mkdtempSync(join(tmpdir(), "ai-stream-"));
  const database = join(dir, "broadcast.sqlite");
  writeFileSync(database, "Existing broadcast is not opened or rewritten");
  const config = configSchema.parse({
    database,
    input: { mode: "ai_stream", streamUrl: url },
    privacy: { rightsDatabase: join(dir, "rights.sqlite") },
    youtube: { enabled: true, consentNoticeEnabled: true },
    chzzk: { enabled: true, consentNoticeEnabled: true },
    soop: {
      mode: "official",
      streamerId: "synthetic",
      consentNoticeEnabled: true,
    },
    capture: {
      backend: "rtmp",
      url: "rtmp://127.0.0.1:1935/private-broadcast",
    },
    audio: { url: "rtmp://127.0.0.1:1935/private-audio" },
    ai: { visualMode: "on_request" },
  });
  const runtime = await createApp(config, {
    demo: false,
    adminToken: admin,
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
    youtubeTokenPath: join(dir, "youtube"),
    chzzkTokenPath: join(dir, "chzzk"),
    soopTokenPath: join(dir, "soop"),
    startInputs: false,
  });
  return {
    ...runtime,
    dir,
    database,
    async close() {
      await runtime.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("AI stream mode isolates storage, rejects chat and notices and uses one dedicated media URL", async () => {
  const f = await fixture();
  try {
    assert.equal(f.participation, undefined);
    assert.equal(f.store.viewerChatEnabled, false);
    assert.equal(f.capture.config.url, f.transcriber.config.url);
    assert.equal(
      f.capture.config.url,
      "rtmp://127.0.0.1:1935/live/synthetic-ai",
    );
    assert(existsSync(f.database + ".ai-stream"));
    assert.equal(
      readFileSync(f.database, "utf8"),
      "Existing broadcast is not opened or rewritten",
    );
    f.supervisor.start();
    f.supervisor.receive(
      "youtube",
      privacyMessage("viewer", "PRIVATE CHAT", Date.now()),
    );
    f.store.ingestBatch([
      privacyMessage("viewer", "!동의", Date.now()),
      privacyMessage("viewer", "PRIVATE CHAT", Date.now()),
    ]);
    for (const table of [
      "messages",
      "actors_private",
      "viewer_consents",
      "chat_context_summaries",
    ])
      assert.equal(
        f.store.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,
        0,
      );
    assert(
      Object.values(f.supervisor.states).every((s) => s.state === "disabled"),
    );
    const headers = {
      host: "127.0.0.1:3210",
      authorization: `Bearer ${admin}`,
    };
    const response = await f.app.inject({ url: "/api/admin/status", headers });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json();
    assert.equal(status.inputMode, "ai_stream");
    assert.equal(status.privacy.ready, true);
    assert.deepEqual(status.privacy.issues, []);
    assert.equal(JSON.stringify(status).includes("synthetic-ai"), false);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/admin/consent-notices/youtube",
          headers,
          payload: { enabled: true },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      status.ai.readiness.checks.some((c: any) => c.id === "privacy"),
      false,
    );
  } finally {
    await f.close();
  }
});
test("AI stream speech drives the real pipeline without participation and closes with normal deletion", async () => {
  const f = await fixture();
  try {
    f.scheduler.providerReady = () => true;
    f.scheduler.random = () => 0;
    f.scheduler.model = async (input, signal) => {
      assert.equal(input.messages.length, 0);
      assert.equal(input.chatSummary?.state, "insufficient_data");
      return fixtureToolModel(input, signal);
    };
    f.personas.prepare();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const transcript = {
      id: "synthetic-speech",
      capturedAt: Date.now(),
      text: "퍼즐 게임 처음 하는데 어떤가요?",
    };
    f.transcriber.transcripts = [transcript];
    f.store.transcripts.record(transcript);
    f.scheduler.start();
    for (let i = 0; i < 100 && !f.scheduler.pending; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(f.scheduler.pending, JSON.stringify(f.scheduler.diagnostics));
    assert.equal(f.store.viewerMemory.list().length, 1);
    assert.equal(f.scheduler.state, "running");
    await f.broadcast.endBroadcast();
    assert(f.store.closed());
    assert.equal(f.store.transcriptCount(), 0);
    assert.deepEqual(f.store.viewerMemory.list(), []);
  } finally {
    await f.close();
  }
});
test("missing AI stream URL cannot fall back to the configured broadcast feed", async () => {
  const f = await fixture("");
  try {
    assert.equal(f.capture.config.url, "");
    assert.equal(f.transcriber.config.url, "");
    f.capture.start();
    assert.equal(f.capture.state, "config_required");
    const status = (
      await f.app.inject({
        url: "/api/admin/status",
        headers: { host: "127.0.0.1:3210", authorization: `Bearer ${admin}` },
      })
    ).json();
    assert.equal(
      status.ai.readiness.checks.find((c: any) => c.id === "stream").ready,
      false,
    );
  } finally {
    await f.close();
  }
});
test("AI stream configuration accepts only explicit RTMP media and disables the chat gate", () => {
  for (const streamUrl of [
    "file:///tmp/private",
    "http://example.com",
    "rtmp://user:pass@example.com/live",
  ])
    assert.equal(
      configSchema.safeParse({ input: { mode: "ai_stream", streamUrl } })
        .success,
      false,
    );
  assert.equal(
    configSchema.safeParse({
      input: { mode: "ai_stream" },
      ai: { gate: { enabled: true }, visualMode: "on_request" },
    }).success,
    false,
  );
});
