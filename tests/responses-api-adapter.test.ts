import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { openaiModel } from "../packages/infrastructure/reactions/responses-api.ts";
import type { ModelInput } from "../packages/application/reactions/model-port.ts";
const input: ModelInput = {
  frames: [],
  messages: [],
  description: "Synthetic",
  persona: { name: "Synthetic", style: "Brief" },
};
const decision = {
  action: "skip",
  text: null,
  replyToMessageId: null,
  evidenceFrameIds: [],
  evidenceMessageIds: [],
  evidenceTranscriptIds: [],
};
const limits = { maxInputTokens: 100, maxOutputTokens: 100 };
function credentials(t: TestContext) {
  const key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_MODEL = "fixture-model";
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
  });
}
test("API adapter authorizes both sends and records each request identifier", async (t) => {
  credentials(t);
  const events: string[] = [];
  const model = openaiModel(
    limits,
    {
      endpoint: () => "https://example.test/v1",
      model: () => "fixture-model",
      authorize: () => events.push("authorize"),
      requestId: (id) => events.push(id),
    },
    async (url, init) => {
      const count = String(url).endsWith("input_tokens");
      events.push(count ? "count" : "generate");
      assert.equal(
        (init!.headers as Record<string, string>).Authorization,
        "Bearer fixture-key",
      );
      return Response.json(
        count
          ? { input_tokens: 10 }
          : {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: JSON.stringify(decision) },
                  ],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 5 },
            },
        { headers: { "x-request-id": count ? "count-id" : "generation-id" } },
      );
    },
  );
  assert.deepEqual(await model(input, new AbortController().signal), {
    decision,
    inputTokens: 10,
    outputTokens: 5,
  });
  assert.deepEqual(events, [
    "authorize",
    "authorize",
    "count",
    "count-id",
    "authorize",
    "generate",
    "generation-id",
  ]);
});
for (const count of [-1, "10", 101])
  test(`invalid or excessive input count ${count} prevents the generation request`, async (t) => {
    credentials(t);
    let calls = 0;
    const model = openaiModel(limits, undefined, async () => {
      calls++;
      return Response.json({ input_tokens: count });
    });
    await assert.rejects(model(input, new AbortController().signal));
    assert.equal(calls, 1);
  });
test("withdrawal after counting prevents the generation send", async (t) => {
  credentials(t);
  let calls = 0,
    allowed = true;
  const model = openaiModel(
    limits,
    {
      endpoint: () => "https://example.test/v1",
      model: () => "fixture-model",
      authorize: () => {
        if (!allowed) throw Error("fixture withdrawn");
      },
    },
    async () => {
      calls++;
      allowed = false;
      return Response.json({ input_tokens: 10 });
    },
  );
  await assert.rejects(
    model(input, new AbortController().signal),
    /fixture withdrawn/,
  );
  assert.equal(calls, 1);
});
test("malformed output usage is rejected before returning an accounting result", async (t) => {
  credentials(t);
  let calls = 0;
  const model = openaiModel(limits, undefined, async () =>
    Response.json(
      ++calls === 1
        ? { input_tokens: 10 }
        : {
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  { type: "output_text", text: JSON.stringify(decision) },
                ],
              },
            ],
            usage: { output_tokens: -1 },
          },
    ),
  );
  await assert.rejects(model(input, new AbortController().signal));
  assert.equal(calls, 2);
});
