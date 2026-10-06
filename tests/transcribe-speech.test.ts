import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transcribeSpeech,
  SpeechProviderError,
  type Transcript,
} from "../packages/application/inputs/transcribe-speech.ts";
import { Transcriber } from "../packages/transcription.ts";
import { configSchema } from "../packages/config.ts";
function fixture() {
  const events: string[] = [],
    published: Transcript[] = [];
  const options = {
    capturedAt: 10,
    current: () => true,
    reserve: () => {
      events.push("reserve");
    },
    request: async () => {
      events.push("request");
      return "  SYNTHETIC_SPEECH  ";
    },
    publish: (entry: Transcript) => {
      events.push("publish");
      published.push(entry);
      return true;
    },
    id: () => "fixture",
  };
  return { events, published, options };
}
test("transcription reserves durable usage before request and publishes normalized text once", async () => {
  const f = fixture();
  assert.equal((await transcribeSpeech(f.options)).kind, "published");
  assert.deepEqual(f.events, ["reserve", "request", "publish"]);
  assert.deepEqual(f.published, [
    { id: "fixture", capturedAt: 10, text: "SYNTHETIC_SPEECH" },
  ]);
});
test("usage persistence failure prevents external transcription", async () => {
  const f = fixture();
  f.options.reserve = () => {
    throw new Error("fixture storage failure");
  };
  assert.deepEqual(await transcribeSpeech(f.options), {
    kind: "failed",
    state: "storage_error",
  });
  assert.deepEqual(f.events, []);
});
for (const failed of [false, true])
  test(`context invalidation while awaiting transcription discards late result (failure=${failed})`, async () => {
    const f = fixture();
    f.options.request = async () => {
      f.options.current = () => false;
      if (failed) throw new SpeechProviderError("auth_required");
      return "LATE";
    };
    assert.equal((await transcribeSpeech(f.options)).kind, "canceled");
    assert.equal(f.published.length, 0);
  });
for (const code of [
  "quota_blocked",
  "auth_required",
  "provider_error",
] as const)
  test(`transcription keeps the scoped ${code} outcome`, async () => {
    const f = fixture();
    f.options.request = async () => {
      throw new SpeechProviderError(code);
    };
    assert.deepEqual(await transcribeSpeech(f.options), {
      kind: "failed",
      state: code,
    });
  });
test("empty provider output is not persisted and rejected persistence is not publication", async () => {
  const f = fixture();
  f.options.request = async () => "  ";
  assert.equal((await transcribeSpeech(f.options)).kind, "empty");
  assert.equal(f.published.length, 0);
  f.options.request = async () => "valid";
  f.options.publish = () => false;
  assert.equal((await transcribeSpeech(f.options)).kind, "discarded");
  f.options.publish = () => {
    throw new Error("fixture storage failure");
  };
  assert.deepEqual(await transcribeSpeech(f.options), {
    kind: "failed",
    state: "storage_error",
  });
});
test("failed usage persistence sends no audio and retains its conservative attempted count", async () => {
  const key = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture-key";
  const config = configSchema.parse({ audio: { maxRequests: 2 } });
  let calls = 0;
  const transcriber = new Transcriber(config.audio, async () => {
    calls++;
    return Response.json({ text: "fixture" });
  });
  try {
    transcriber.state = "receiving";
    transcriber.onRequest = () => {
      throw new Error("fixture persistence failure");
    };
    await transcriber.transcribe(Buffer.alloc(320000));
    assert.equal(calls, 0);
    assert.equal(transcriber.requests, 1);
    assert.equal(transcriber.state, "storage_error");
    transcriber.onRequest = () => {};
    await transcriber.transcribe(Buffer.alloc(320000));
    assert.equal(calls, 1);
    assert.equal(transcriber.requests, 2);
  } finally {
    transcriber.stop();
    if (key === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = key;
  }
});
