import { syntheticMessage } from "./helpers/message.ts";
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
import { fixtureToolModel } from "../packages/infrastructure/experiments/models.ts";

const admin = "a".repeat(64);
async function fixture(url = "rtmp://127.0.0.1:1935/live/synthetic-ai") {
  const dir = mkdtempSync(join(tmpdir(), "ai-stream-"));
  const database = join(dir, "broadcast.sqlite");
  writeFileSync(database, "Existing broadcast is not opened or rewritten");
  const config = configSchema.parse({
    database,
    input: { mode: "ai_stream", streamUrl: url },
    ai: { visualMode: "on_request" },
  });
  const runtime = await createApp(config, {
    demo: false,
    adminToken: admin,
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
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
    assert.throws(() =>
      f.store.ingestBatch([
        {
          ...syntheticMessage("viewer", "REJECTED"),
          platform: "youtube",
        } as any,
      ]),
    );
    for (const table of ["messages", "actors_private"])
      assert.equal(
        f.store.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,
        0,
      );
    for (const name of [
      "viewer_consents",
      "chat_context_summaries",
      "consent_notice_targets",
      "consent_notice_state",
    ])
      assert.equal(
        f.store.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(name),
        undefined,
      );
    const headers = {
      host: "127.0.0.1:3210",
      authorization: `Bearer ${admin}`,
    };
    const response = await f.app.inject({ url: "/api/admin/status", headers });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json();
    assert.equal(status.inputMode, "ai_stream");
    assert.equal(status.privacy, undefined);
    assert.equal(status.connectors, undefined);
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
      404,
    );
    for (const [method, url] of [
      ["GET", "/api/admin/participation"],
      ["POST", "/api/admin/connectors/start"],
      ["POST", "/api/admin/youtube/authorize"],
      ["PUT", "/api/admin/privacy/profile"],
    ] as const) {
      assert.equal(
        (await f.app.inject({ method, url, headers })).statusCode,
        404,
        url,
      );
    }
    assert.equal(
      status.ai.readiness.checks.some((c: any) => c.id === "privacy"),
      false,
    );
  } finally {
    await f.close();
  }
});
test("AI stream speech drives the real pipeline from dedicated media and closes with normal deletion", async () => {
  const f = await fixture();
  try {
    f.display.receive({
      platform: "youtube",
      channel: "fixture",
      sourceId: "real-1",
      author: "private-viewer",
      name: "PRIVATE_NAME",
      text: "PRIVATE_REAL_CHAT",
    });
    f.scheduler.providerReady = () => true;
    f.scheduler.random = () => 0;
    f.scheduler.model = async (input, signal) => {
      assert.equal(input.messages.length, 0);
      assert.equal(JSON.stringify(input).includes("PRIVATE"), false);
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
test("AI stream configuration accepts only explicit RTMP media and rejects retired settings", () => {
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

test("retired configuration sections and broadcast input mode are rejected", () => {
  for (const key of ["youtube", "chzzk", "soop", "privacy"])
    assert.equal(configSchema.safeParse({ [key]: {} }).success, false, key);
  assert.equal(
    configSchema.safeParse({ input: { mode: "broadcast" } }).success,
    false,
  );
});

test("deferred server startup also starts enabled platform reception", async () => {
  const f = await fixture("");
  try {
    f.displayChat.settings.youtube.enabled = false;
    f.displayChat.settings.chzzk.enabled = false;
    f.displayChat.settings.soop.enabled = true;
    assert.equal(f.displayChat.status().platforms.soop.state, "stopped");
    f.startInputs();
    assert.equal(
      f.displayChat.status().platforms.soop.state,
      "awaiting_browser",
    );
    assert.equal(f.capture.state, "config_required");
  } finally {
    await f.close();
  }
});
