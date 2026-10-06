import { test } from "node:test";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { configSchema } from "../packages/config.ts";
import { Transcriber, wavFromPcm } from "../packages/transcription.ts";
import { Capture } from "../packages/capture.ts";
import { Store } from "../packages/storage.ts";
import { Scheduler } from "../packages/scheduler.ts";
import { createApp } from "../apps/server/app.ts";
import {
  modelMessages,
  validateDecision,
  type Model,
  type ModelInput,
} from "../packages/model.ts";

const audioUrl = "rtmp://127.0.0.1:1935/program?user=reader&pass=private";

test("Groq Whisper receives bounded WAV chunks and keeps transcript private", async () => {
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture-groq-key";
  let seen = 0;
  const request = (async (url: string, init: RequestInit) => {
    seen++;
    assert.equal(url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(init.method, "POST");
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      "Bearer fixture-groq-key",
    );
    const body = init.body as FormData;
    assert.equal(body.get("model"), "whisper-large-v3-turbo");
    assert.equal(body.get("response_format"), "json");
    assert.equal(body.get("language"), "ko");
    const file = body.get("file") as File;
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.readUInt32LE(24), 16000);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.length, 44 + 320000);
    return Response.json({ text: "화면을 봐 주세요" });
  }) as typeof fetch;
  try {
    const config = configSchema.parse({
      audio: { url: audioUrl, maxRequests: 1, language: "ko" },
    });
    const store = new Store(":memory:");
    const transcription = new Transcriber(config.audio, request, (entry) =>
      store.recordTranscript(entry),
    );
    transcription.state = "receiving";
    const pcm = Buffer.alloc(320000);
    assert.equal(wavFromPcm(pcm).length, 320044);
    await transcription.transcribe(pcm);
    assert.equal(seen, 1);
    assert.equal(transcription.recent()[0]?.text, "화면을 봐 주세요");
    assert.equal(store.transcriptRows()[0]?.text, "화면을 봐 주세요");
    assert.equal(store.snapshot().messages.length, 0);
    assert.equal(transcription.state, "budget_exhausted");
    await transcription.transcribe(pcm);
    assert.equal(seen, 1);
    store.close();
  } finally {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

test("transcription language defaults to auto and validates code format", () => {
  assert.equal(configSchema.parse({}).audio.language, "");
  assert.equal(configSchema.parse({ audio: {} }).audio.language, "");
  for (const language of ["", "ko", "en", "ja"])
    assert.equal(
      configSchema.parse({ audio: { language } }).audio.language,
      language,
    );
  for (const language of ["Korean", "ko-KR", "KO", "k", " ko", null])
    assert.equal(
      configSchema.safeParse({ audio: { language } }).success,
      false,
    );
});

test("automatic language detection omits the provider language parameter", async () => {
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture-groq-key";
  try {
    for (const audio of [{}, { language: "" }, { language: "ja" }]) {
      let seen = false;
      const transcription = new Transcriber(
        configSchema.parse({ audio }).audio,
        (async (_url, init) => {
          seen = true;
          const body = init!.body as FormData;
          assert.equal(body.get("language"), audio.language || null);
          return Response.json({ text: "fixture transcript" });
        }) as typeof fetch,
      );
      transcription.state = "receiving";
      await transcription.transcribe(Buffer.alloc(320000));
      assert.equal(seen, true);
      assert.equal(transcription.recent().length, 1);
      transcription.stop();
    }
  } finally {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

test("text-first AI sends no image until it asks to inspect masked video", async () => {
  const config = configSchema.parse({
    ai: { visualMode: "on_request", manualApproval: false },
  });
  const store = new Store(":memory:");
  const capture = new Capture(config.capture, true);
  capture.add(
    {
      capturedAt: Date.now(),
      width: 8,
      height: 8,
      bytes: Buffer.from("masked-image"),
    },
    "demo",
  );
  const transcript = {
    id: "speech-1",
    capturedAt: Date.now(),
    text: "저 물체가 뭘까요?",
  };
  const transcription = {
    recent: () => [transcript],
    has: (id: string) => id === transcript.id,
  } as Transcriber;
  const calls: number[] = [];
  const model: Model = async (input: ModelInput) => {
    calls.push(input.frames.length);
    const content = modelMessages(input)[1].content as any[];
    assert.equal(
      content.filter((part) => part.type === "input_image").length,
      input.frames.length,
    );
    if (!input.frames.length)
      return {
        decision: {
          action: "inspect",
          text: null,
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: [],
          evidenceTranscriptIds: [transcript.id],
        },
      };
    return {
      decision: {
        action: "say",
        text: "화면에 물체가 보여요.",
        replyToMessageId: null,
        evidenceFrameIds: [input.frames[0].id],
        evidenceMessageIds: [],
        evidenceTranscriptIds: [transcript.id],
      },
    };
  };
  const scheduler = new Scheduler(
    store,
    capture,
    config,
    model,
    true,
    () => true,
    transcription,
  );
  try {
    scheduler.state = "running";
    await scheduler.tick();
    assert.deepEqual(calls, [0, 1]);
    assert.equal(store.usage().calls, 2);
    assert.equal(store.snapshot().messages.length, 1);
    scheduler.lastAttempt = 0;
    scheduler.lastSpoke = 0;
    await scheduler.tick();
    assert.deepEqual(calls, [0, 1]);
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("text-only speech can be used without a camera and cannot invent transcript evidence", async () => {
  const config = configSchema.parse({
    ai: { visualMode: "on_request", manualApproval: false },
  });
  const store = new Store(":memory:");
  const capture = new Capture(config.capture, false);
  const transcript = {
    id: "speech-2",
    capturedAt: Date.now(),
    text: "안녕하세요",
  };
  const transcription = {
    recent: () => [transcript],
    has: (id: string) => id === transcript.id,
  } as Transcriber;
  const scheduler = new Scheduler(
    store,
    capture,
    config,
    async (input) => ({
      decision: {
        action: "say",
        text: "안녕하세요!",
        replyToMessageId: null,
        evidenceFrameIds: [],
        evidenceMessageIds: [],
        evidenceTranscriptIds: [input.transcripts![0].id],
      },
    }),
    true,
    () => true,
    transcription,
  );
  try {
    scheduler.start();
    for (let i = 0; i < 20 && !store.snapshot().messages.length; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(store.snapshot().messages.length, 1);
    assert.equal(capture.frames.length, 0);
    assert.throws(() =>
      validateDecision(
        {
          action: "say",
          text: "안녕하세요!",
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: [],
          evidenceTranscriptIds: ["invented"],
        },
        {
          frames: [],
          transcripts: [transcript],
          messages: [],
          persona: config.ai.personas[0],
          description: "",
        },
      ),
    );
  } finally {
    scheduler.stop();
    store.close();
  }
});

test("RTMP audio worker skips silence and forwards bounded speech PCM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mixed-audio-worker-"));
  const executable = join(directory, "fake-ffmpeg");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
process.stdout.write(Buffer.alloc(320000));
const voiced = Buffer.alloc(320000);
for (let i = 0; i < voiced.length; i += 2) voiced.writeInt16LE(1000, i);
process.stdout.write(voiced);
setInterval(() => {}, 1000);
`,
  );
  chmodSync(executable, 0o700);
  const child = fork(new URL("../workers/audio.mjs", import.meta.url), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    const received = await new Promise<{ activities: number; pcm: Buffer }>(
      (resolve, reject) => {
        let activities = 0;
        const timeout = setTimeout(
          () => reject(Error("No audio chunk received")),
          3000,
        );
        child.on("message", (message: any) => {
          if (message.type === "activity") activities++;
          if (message.type === "audio") {
            clearTimeout(timeout);
            resolve({ activities, pcm: Buffer.from(message.pcm, "base64") });
          }
        });
        child.send({
          type: "start",
          config: { ffmpeg: executable, url: audioUrl, chunkSeconds: 10 },
        });
      },
    );
    assert.equal(received.activities, 2);
    assert.equal(received.pcm.length, 320000);
    assert.equal(received.pcm.readInt16LE(0), 1000);
  } finally {
    child.send({ type: "stop" });
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transcript log persists across restart and follows retention and deletion", () => {
  const directory = mkdtempSync(join(tmpdir(), "mixed-transcript-log-"));
  const path = join(directory, "chat.sqlite");
  try {
    const store = new Store(path);
    const sessionId = store.sessionId;
    assert.equal(
      store.recordTranscript({ id: "old", capturedAt: 1, text: "earlier" }),
      true,
    );
    assert.equal(
      store.recordTranscript({
        id: "new",
        capturedAt: Date.now(),
        text: "now",
      }),
      true,
    );
    store.close();
    const reopened = new Store(path);
    assert.deepEqual(
      reopened.transcriptRows().map((entry) => entry.text),
      ["now", "earlier"],
    );
    assert.equal(reopened.transcriptRows()[0].sessionId, sessionId);
    assert.equal(reopened.transcriptCount(), 2);
    reopened.purge(100);
    assert.equal(reopened.transcriptCount(), 1);
    assert.equal(JSON.parse([...reopened.exportTranscripts()][0]).text, "now");
    reopened.deleteAll();
    assert.equal(reopened.transcriptCount(), 0);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transcripts work without privacy enable flags and export still requires administrator authentication", async () => {
  const config = configSchema.parse({
    database: ":memory:",
    privacy: { rightsDatabase: ":memory:" },
    ai: { visualMode: "on_request" },
  });
  const adminToken = "a".repeat(32);
  const directory = mkdtempSync(join(tmpdir(), "mixed-transcript-api-"));
  const { app, store } = await createApp(config, {
    adminToken,
    readerToken: "b".repeat(32),
    encryptionKey: "c".repeat(64),
    chatgptTokenPath: join(directory, "chatgpt.tokens"),
    youtubeTokenPath: join(directory, "youtube.tokens"),
    chzzkTokenPath: join(directory, "chzzk.tokens"),
    soopTokenPath: join(directory, "soop.tokens"),
    startInputs: false,
  });
  try {
    store.recordTranscript({
      id: "private",
      capturedAt: Date.now(),
      text: "private speech",
    });
    const denied = await app.inject({
      method: "GET",
      url: "/api/admin/transcripts/export",
      headers: { host: `127.0.0.1:${config.port}` },
    });
    assert.equal(denied.statusCode, 401);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/admin/transcripts/export",
      headers: {
        host: `127.0.0.1:${config.port}`,
        authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(store.transcriptCount(), 1);
    assert.equal(store.snapshot().messages.length, 0);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/admin/ai/start",
      headers: {
        host: `127.0.0.1:${config.port}`,
        authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.json().error, /필수 입력/);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opt-in live audio stores and exports session transcripts, then erases speech on withdrawal and rejects late results", async (t) => {
  const { approvedProfile, privacyMessage } =
    await import("./privacy-fixtures.ts");
  const profile = approvedProfile();
  for (const [key, value] of Object.entries({
    OPENAI_API_KEY: "fixture",
    OPENAI_MODEL: "fixture-model",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  let modelRequests = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    modelRequests++;
    const body = JSON.parse(init.body);
    assert(JSON.stringify(body.input).includes("Fixture speech context"));
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

  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture";
  t.after(() => {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  });
  const directory = mkdtempSync(join(tmpdir(), "live-audio-optin-"));
  const config = configSchema.parse({ database: ":memory:", privacy: profile });
  const instance = await createApp(config, {
    adminToken: "a".repeat(32),
    readerToken: "b".repeat(32),
    encryptionKey: "c".repeat(64),
    startInputs: false,
    chatgptTokenPath: join(directory, "chatgpt"),
    youtubeTokenPath: join(directory, "youtube"),
    chzzkTokenPath: join(directory, "chzzk"),
    soopTokenPath: join(directory, "soop"),
  });
  const { app, store, transcriber } = instance;
  const headers = {
    host: `127.0.0.1:${config.port}`,
    authorization: `Bearer ${"a".repeat(32)}`,
  };
  try {
    transcriber.request = async () =>
      Response.json({ text: "Fixture speech context" });
    transcriber.state = "receiving";
    await transcriber.transcribe(Buffer.alloc(320000));
    assert.equal(store.transcriptCount(), 1);
    assert.equal(transcriber.recent().length, 1);
    const input: ModelInput = {
      frames: [],
      messages: [],
      transcripts: transcriber.recent(),
      newTranscripts: transcriber.recent(),
      privacyRevision: instance.participation!.revision,
      persona: { name: "fixture", style: "brief" },
      description: "speech only",
    };
    await instance.scheduler.model(input, new AbortController().signal);
    assert.equal(modelRequests, 2);

    const status = (
      await app.inject({ url: "/api/admin/status", headers })
    ).json();
    assert.equal(transcriber.allowProcessing(), true);
    assert.equal(
      (
        await app.inject({
          url: "/api/admin/transcripts/export",
          headers: { host: `127.0.0.1:${config.port}` },
        })
      ).statusCode,
      401,
    );
    const exported = await app.inject({
      url: "/api/admin/transcripts/export",
      headers,
    });
    assert.equal(exported.statusCode, 200);
    assert.equal(
      JSON.parse(exported.body.trim()).text,
      "Fixture speech context",
    );
    assert.equal(store.snapshot().messages.length, 0);
    let release!: (r: Response) => void;
    transcriber.request = () =>
      new Promise((r) => {
        release = r;
      });
    const pending = transcriber.transcribe(Buffer.alloc(320000));
    store.ingestBatch([privacyMessage("u", "!철회", Date.now() + 1)]);
    assert.equal(store.transcriptCount(), 0);
    assert.equal(transcriber.recent().length, 0);
    await assert.rejects(
      instance.scheduler.model(
        { ...input, privacyRevision: instance.participation!.revision },
        new AbortController().signal,
      ),
    );
    assert.equal(modelRequests, 2);
    release(Response.json({ text: "Late withdrawn context" }));
    await pending;
    assert.equal(store.transcriptCount(), 0);
    assert.equal(transcriber.recent().length, 0);
    assert.equal(
      (await app.inject({ url: "/api/admin/transcripts/export", headers }))
        .statusCode,
      200,
    );
    assert.equal(transcriber.allowProcessing(), true);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
