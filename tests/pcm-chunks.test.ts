import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PcmChunks,
  floatToPcm,
  speechInPcm,
} from "../packages/domain/inputs/pcm-chunks.ts";
import { Transcriber } from "../packages/infrastructure/inputs/speech-input.ts";
import { configSchema } from "../packages/config.ts";
test("broadcast and browser share exact frames, RMS threshold and partial-stop discard", () => {
  const chunks = new PcmChunks(10);
  const speech = floatToPcm(new Float32Array(160000).fill(0.02));
  assert.equal(speech.byteLength, 320000);
  assert.deepEqual(chunks.push(speech.subarray(0, 123)), []);
  const split = chunks.push(speech.subarray(123));
  assert.equal(split.length, 1);
  assert(split[0].speech);
  assert.deepEqual(split[0].pcm, speech);
  const silence = chunks.push(new Uint8Array(320000));
  assert.equal(silence[0].speech, false);
  assert(!speechInPcm(floatToPcm(new Float32Array(160).fill(140 / 32767))));
  assert(speechInPcm(floatToPcm(new Float32Array(160).fill(141 / 32767))));
  chunks.push(speech.subarray(0, 100));
  chunks.clear();
  assert.deepEqual(chunks.push(speech.subarray(100)), []);
  assert.throws(() => new PcmChunks(1));
});
test("PCM admission reuses live transcription truncation, accounting, busy discard and cancellation", async () => {
  const prior = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture";
  let release!: () => void,
    calls = 0;
  const published: Array<{ text: string; capturedAt: number }> = [];
  const transcriber = new Transcriber(
    configSchema.parse({ audio: { maxRequests: 2 } }).audio,
    (async () => {
      calls++;
      await new Promise<void>((resolve) => (release = resolve));
      return Response.json({ text: "가".repeat(1100) });
    }) as typeof fetch,
    (entry) => {
      published.push(entry);
      return true;
    },
  );
  try {
    transcriber.startPcm();
    const first = transcriber.transcribe(Buffer.alloc(320000), 123);
    await transcriber.transcribe(Buffer.alloc(320000), 124);
    assert.equal(calls, 1);
    release();
    await first;
    assert.equal(published[0].capturedAt, 123);
    assert.equal(published[0].text.length, 1000);
    const canceled = transcriber.transcribe(Buffer.alloc(320000), 125);
    transcriber.stop();
    release();
    await canceled;
    assert.equal(published.length, 1);
    assert.equal(transcriber.requests, 2);
    transcriber.startPcm();
    assert.equal(transcriber.state, "budget_exhausted");
  } finally {
    transcriber.stop();
    if (prior === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prior;
  }
});
