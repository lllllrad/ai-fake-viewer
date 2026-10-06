import { test } from "node:test";
import assert from "node:assert/strict";
import { chatgptModel } from "../packages/infrastructure/reactions/chatgpt-model.ts";
import { configSchema } from "../packages/config.ts";
import {
  generationIssue,
  ModelRequestError,
} from "../packages/model-errors.ts";
const auth = {
  active: { clientId: "fixture", model: "fixture" },
  access: async () => "SECRET",
} as any;
const input = {
  frames: [],
  messages: [],
  persona: { name: "fixture", style: "brief" },
  description: "fixture",
};
const decision = {
  action: "skip",
  text: null,
  replyToMessageId: null,
  evidenceFrameIds: [],
  evidenceMessageIds: [],
};
for (const [status, retryable] of [
  [401, false],
  [403, false],
  [429, true],
  [503, true],
] as const) {
  test(`provider HTTP ${status} is classified without exposing response bodies`, async () => {
    const model = chatgptModel(
      configSchema.parse({}).ai,
      auth,
      async () => new Response("PRIVATE BODY", { status }),
    );
    await assert.rejects(
      model(input, new AbortController().signal),
      (e: any) => {
        assert(e instanceof ModelRequestError);
        assert.equal(generationIssue(e).code, `provider_http_${status}`);
        assert.equal(generationIssue(e).retryable, retryable);
        assert.deepEqual(e.details, { status });
        assert(!JSON.stringify(e).includes("PRIVATE BODY"));
        return true;
      },
    );
  });
}
for (const [kind, usage, actual, limit] of [
  ["input", { input_tokens: 24001, output_tokens: 10 }, 24001, 24000],
  ["output", { input_tokens: 20, output_tokens: 501 }, 501, 500],
] as const) {
  test(`${kind} token limit exposes exact usage and limit`, async () => {
    const event = {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(decision) }],
          },
        ],
        usage,
      },
    };
    const model = chatgptModel(
      configSchema.parse({}).ai,
      auth,
      async () => new Response(`data: ${JSON.stringify(event)}\n\n`),
    );
    await assert.rejects(
      model(input, new AbortController().signal),
      (e: any) => {
        assert.equal(generationIssue(e).code, `${kind}_token_limit`);
        assert.deepEqual(e.details, { actual, limit });
        assert.equal(generationIssue(e).retryable, false);
        return true;
      },
    );
  });
}
test("incomplete stream is retryable but never accepted as a completed decision", async () => {
  const model = chatgptModel(
    configSchema.parse({}).ai,
    auth,
    async () =>
      new Response(
        'data: {"type":"response.output_text.delta","delta":"{}"}\n\n',
      ),
  );
  await assert.rejects(model(input, new AbortController().signal), (e: any) => {
    assert.equal(generationIssue(e).code, "provider_stream_interrupted");
    assert.equal(generationIssue(e).transient, true);
    return true;
  });
});
