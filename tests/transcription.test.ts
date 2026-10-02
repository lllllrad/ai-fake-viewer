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
      audio: { enabled: true, url: audioUrl, maxRequests: 1 },
    });
    const transcription = new Transcriber(config.audio, true, request);
    transcription.state = "receiving";
    const pcm = Buffer.alloc(320000);
    assert.equal(wavFromPcm(pcm).length, 320044);
    await transcription.transcribe(pcm);
    assert.equal(seen, 1);
    assert.equal(transcription.recent()[0]?.text, "화면을 봐 주세요");
    assert.equal(transcription.state, "budget_exhausted");
    await transcription.transcribe(pcm);
    assert.equal(seen, 1);
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
  capture.confirmed = true;
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
