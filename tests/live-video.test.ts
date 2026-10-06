import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
import { assertProfileUpdate } from "../packages/privacy-profile.ts";

test("reviewed live video reaches model and is invalidated by withdrawal, including late frames", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const profile = approvedProfile();
  profile.noticeVersion = "video-2";
  assert.doesNotThrow(() => assertProfileUpdate(approvedProfile(), profile));
  for (const [key, value] of Object.entries({
    OPENAI_API_KEY: "fixture",
    OPENAI_MODEL: "fixture-model",
  })) {
    const prior = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    });
  }
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    assert(JSON.stringify(body.input).includes("data:image/jpeg;base64,"));
    if (String(url).endsWith("/input_tokens"))
      return Response.json({ input_tokens: 10 });
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                action: "skip",
                text: null,
                replyToMessageId: null,
                evidenceFrameIds: [],
                evidenceMessageIds: [],
                evidenceTranscriptIds: [],
              }),
            },
          ],
        },
      ],
    });
  });
  const dir = mkdtempSync(join(tmpdir(), "live-video-"));
  const config = configSchema.parse({
    database: ":memory:",
    privacy: profile,
    ai: { visualMode: "continuous" },
  });
  const i = await createApp(config, {
    adminToken: "a".repeat(32),
    readerToken: "b".repeat(32),
    encryptionKey: "c".repeat(64),
    startInputs: false,
    chatgptTokenPath: join(dir, "chatgpt"),
    youtubeTokenPath: join(dir, "youtube"),
    chzzkTokenPath: join(dir, "chzzk"),
    soopTokenPath: join(dir, "soop"),
  });
  const headers = {
    host: `127.0.0.1:${config.port}`,
    authorization: `Bearer ${"a".repeat(32)}`,
  };
  try {
    const frame = {
      capturedAt: now,
      width: 2,
      height: 2,
      bytes: Buffer.from("synthetic-image"),
    };
    i.capture.add(frame, "obs_program");
    assert.equal(i.capture.recent().length, 1);
    const input = {
      frames: i.capture.recent(),
      messages: [],
      privacyRevision: i.participation!.revision,
      persona: { name: "fixture", style: "brief" },
      description: "synthetic video",
    };
    await i.scheduler.model(input, new AbortController().signal);
    assert.equal(calls, 2);
    const status = (
      await i.app.inject({ url: "/api/admin/status", headers })
    ).json();
    assert.equal(status.capture.configured, true);
    assert.equal(status.ai.visualMode, "continuous");
    now += 11000;
    assert.equal(i.capture.recent().length, 0);
    assert.equal(i.capture.has(input.frames[0].id), true);
    i.store.ingestBatch([privacyMessage("u", "!철회", now)]);
    assert.equal(i.capture.frames.length, 0);
    i.capture.add(frame, "obs_program");
    assert.equal(i.capture.frames.length, 0);
    await assert.rejects(
      i.scheduler.model(
        { ...input, privacyRevision: i.participation!.revision },
        new AbortController().signal,
      ),
    );
    assert.equal(calls, 2);
    i.capture.add({ ...frame, capturedAt: ++now }, "obs_program");
    assert.equal(i.capture.recent().length, 1);
    now += 30001;
    assert.equal(i.capture.has(i.capture.latest()!.id), false);
    let starts = 0;
    t.mock.method(i.capture, "start", () => {
      starts++;
    });
    assert.equal(
      (
        await i.app.inject({
          method: "POST",
          url: "/api/admin/capture/start",
          headers,
        })
      ).statusCode,
      200,
    );
    assert.equal(starts, 1);
  } finally {
    await i.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
