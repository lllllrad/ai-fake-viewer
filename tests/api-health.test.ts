import { test } from "node:test";
import assert from "node:assert/strict";
import { apiIssues } from "../packages/api-health.ts";
import { Transcriber } from "../packages/infrastructure/inputs/speech-input.ts";
import { configSchema } from "../packages/config.ts";
const base = {
  youtubeRead: { state: "subscribed" },
  youtubeSend: { state: "ready" },
  chzzkSend: { state: "ready" },
  audioState: "receiving",
  modelState: "running",
};
test("Groq provider quota is separate from the app transcription call cap", async (t) => {
  const prior = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture";
  t.after(() => {
    if (prior === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prior;
  });
  const tr = new Transcriber(
    configSchema.parse({}).audio,
    async () => new Response("", { status: 429 }),
  );
  tr.state = "receiving";
  await tr.transcribe(Buffer.alloc(320));
  assert.equal(tr.state, "quota_blocked");
  assert.equal(tr.requests, 1);
  tr.stop();
});
