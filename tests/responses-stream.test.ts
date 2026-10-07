import { test } from "node:test";
import assert from "node:assert/strict";
import { readResponsesStream } from "../packages/infrastructure/reactions/responses-stream.ts";
const encoder = new TextEncoder();
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const completed = (
  text: string,
  usage: unknown = { input_tokens: 2, output_tokens: 3 },
) => ({
  type: "response.completed",
  response: {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage,
  },
});
test("completed tool items survive an empty terminal output array, preserving reasoning and order", async () => {
  const reasoning = {
    type: "reasoning",
    id: "rs_fixture",
    summary: [],
    encrypted_content: "synthetic-opaque",
  };
  const call = {
    type: "function_call",
    call_id: "call_fixture",
    name: "wait",
    arguments: "{}",
  };
  const fixture = stream([
    encoder.encode(
      frame({
        type: "response.output_item.done",
        output_index: 1,
        item: call,
      }) +
        frame({
          type: "response.output_item.done",
          output_index: 0,
          item: reasoning,
        }) +
        frame({
          type: "response.completed",
          response: {
            status: "completed",
            output: [],
            usage: {
              input_tokens: 12,
              output_tokens: 4,
              input_tokens_details: { cached_tokens: 8 },
            },
          },
        }),
    ),
  ]);
  const result = await readResponsesStream(
    fixture.body,
    new AbortController().signal,
    true,
  );
  assert.deepEqual(result.toolCalls, [call]);
  assert.deepEqual(result.continuation, [reasoning, call]);
  assert.equal(result.cachedInputTokens, 8);
});
test("partial tools or completed items without response completion never qualify", async () => {
  const call = {
    type: "function_call",
    call_id: "call_fixture",
    name: "wait",
    arguments: "{}",
  };
  for (const events of [
    [
      { type: "response.output_item.added", output_index: 0, item: call },
      {
        type: "response.completed",
        response: { status: "completed", output: [] },
      },
    ],
    [{ type: "response.output_item.done", output_index: 0, item: call }],
  ]) {
    const fixture = stream([encoder.encode(events.map(frame).join(""))]);
    await assert.rejects(
      readResponsesStream(fixture.body, new AbortController().signal, true),
    );
  }
});
function stream(chunks: Uint8Array[], close = true) {
  let canceled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel() {
      canceled++;
    },
  });
  return { body, canceled: () => canceled };
}
test("stream decoding handles every UTF-8 byte and event boundary split", async () => {
  const text = '{"text":"안녕하세요"}';
  const bytes = encoder.encode(
    frame({ type: "response.output_text.delta", delta: text }) +
      frame(completed(text)),
  );
  const fixture = stream([...bytes].map((byte) => Uint8Array.of(byte)));
  assert.deepEqual(
    await readResponsesStream(fixture.body, new AbortController().signal),
    { output: text, inputTokens: 2, outputTokens: 3 },
  );
  assert.equal(fixture.body.locked, false);
});
test("CRLF and multiline SSE data fields retain completion and delta fallback", async () => {
  const payload =
    frame({
      type: "response.output_text.delta",
      delta: "Synthetic text",
    }).replaceAll("\n", "\r\n") +
    'event: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":{"status":"completed","output":[]}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const fixture = stream([encoder.encode(payload)]);
  assert.equal(
    (await readResponsesStream(fixture.body, new AbortController().signal))
      .output,
    "Synthetic text",
  );
});
test("a malformed delta cancels an unfinished stream and releases its lock", async () => {
  const fixture = stream(
    [encoder.encode(frame({ type: "response.output_text.delta", delta: 42 }))],
    false,
  );
  await assert.rejects(
    readResponsesStream(fixture.body, new AbortController().signal),
    /Invalid ChatGPT text delta/,
  );
  assert.equal(fixture.canceled(), 1);
  assert.equal(fixture.body.locked, false);
});
test("completion is required even when text and a DONE marker arrived", async () => {
  const fixture = stream([
    encoder.encode(
      frame({ type: "response.output_text.delta", delta: "Synthetic" }) +
        "data: [DONE]\n\n",
    ),
  ]);
  await assert.rejects(
    readResponsesStream(fixture.body, new AbortController().signal),
    /ended before completion/,
  );
  assert.equal(fixture.body.locked, false);
});
test("caller cancellation wakes an idle reader and releases transport ownership", async () => {
  const fixture = stream([], false),
    controller = new AbortController();
  const result = readResponsesStream(fixture.body, controller.signal);
  const rejected = assert.rejects(result, /fixture abort/);
  controller.abort(Error("fixture abort"));
  await rejected;
  assert.equal(fixture.canceled(), 1);
  assert.equal(fixture.body.locked, false);
});
test("an already aborted call cancels a response body it never reads", async () => {
  const fixture = stream([], false),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(readResponsesStream(fixture.body, controller.signal), {
    name: "AbortError",
  });
  assert.equal(fixture.canceled(), 1);
  assert.equal(fixture.body.locked, false);
});
test("oversized streams and text are rejected before accepting a candidate", async () => {
  for (const chunks of [
    [new Uint8Array(1024 * 1024 + 1)],
    [
      encoder.encode(
        frame({ type: "response.output_text.delta", delta: "x".repeat(10001) }),
      ),
    ],
  ]) {
    const fixture = stream(chunks, false);
    await assert.rejects(
      readResponsesStream(fixture.body, new AbortController().signal),
      /too large/,
    );
    assert.equal(fixture.canceled(), 1);
    assert.equal(fixture.body.locked, false);
  }
});
test("invalid usage counts and output text types cannot enter model accounting", async () => {
  for (const event of [
    completed("Synthetic", { input_tokens: -1 }),
    completed("Synthetic", { output_tokens: "10" }),
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: 42 }] },
        ],
      },
    },
  ]) {
    const fixture = stream([encoder.encode(frame(event))]);
    await assert.rejects(
      readResponsesStream(fixture.body, new AbortController().signal),
    );
    assert.equal(fixture.body.locked, false);
  }
});
