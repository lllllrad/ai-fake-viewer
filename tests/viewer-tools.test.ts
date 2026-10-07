import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import {
  generateToolDraft,
  viewerTools,
} from "../services/viewer-ai/tool-draft.ts";
import {
  modelRequest,
  inspectedModelRequest,
} from "../packages/infrastructure/reactions/model-request.ts";
import { readResponsesStream } from "../packages/infrastructure/reactions/responses-stream.ts";
import { openaiModel } from "../packages/infrastructure/reactions/responses-api.ts";
import type { DraftOptions } from "../packages/application/reactions/program.ts";
const state = {
  mood: "curious",
  focus: "puzzle",
  intent: "listen",
  summary: "A synthetic puzzle conversation",
};
const input = {
  persona: { name: "fixture", style: "curious" },
  description: "synthetic",
  frames: [],
  messages: [],
  contextKey: "synthetic-cache",
};
const call = (name: string, args: unknown, id = name) => ({
  type: "function_call" as const,
  name,
  call_id: id,
  arguments: JSON.stringify(args),
});
function options(): DraftOptions<Uint8Array> {
  return {
    input,
    signal: new AbortController().signal,
    isCurrent: () => true,
    inspectAllowed: false,
    review: false,
    latestFrames: () => [],
    hasTranscript: () => false,
    active() {},
    phase() {},
    trace() {},
    model: async () => ({ toolCalls: [call("wait", {})] }),
  };
}
test("state tool writes are returned to the next model round and terminal tools keep host decisions", async () => {
  const opts = options();
  let calls = 0,
    writes = 0;
  opts.updateState = async (values) => ({
    memberId: "one",
    binding: "standard",
    revision: ++writes,
    updatedAt: 100,
    expiresAt: 200,
    values,
  });
  opts.model = async (request) => {
    assert.equal(request.tools?.length, 4);
    if (calls++ === 0) return { toolCalls: [call("update_state", state)] };
    assert.equal(request.viewerState, undefined); // Stable initial prefix is reused.
    const effect = request.continuation?.at(-1);
    assert(effect?.type === "function_call_output");
    assert.deepEqual(JSON.parse(effect.output).values, state);
    assert.equal(request.continuation?.at(-1)?.type, "function_call_output");
    return { toolCalls: [call("wait", {})] };
  };
  assert.equal((await generateToolDraft(opts)).kind, "skipped");
  assert.equal(writes, 1);
  assert.equal(calls, 2);
});
test("conflicting tools, malformed state and canceled completions cannot mutate state", async () => {
  for (const toolCalls of [
    [call("update_state", state), call("wait", {}), call("inspect_screen", {})],
    [call("update_state", { ...state, extra: "private" })],
    [call("update_state", state), call("update_state", state)],
  ]) {
    const opts = options();
    let writes = 0;
    opts.updateState = async () => {
      writes++;
      throw Error("unexpected write");
    };
    opts.model = async () => ({ toolCalls });
    await assert.rejects(generateToolDraft(opts));
    assert.equal(writes, 0);
  }
  const opts = options();
  const abort = new AbortController();
  opts.signal = abort.signal;
  opts.model = async () => {
    abort.abort();
    return { toolCalls: [call("update_state", state)] };
  };
  await assert.rejects(generateToolDraft(opts), /abort/i);
});
test("state is isolated by viewer and implementation, expires without sliding and clears on invalidation", () => {
  let now = 100;
  const store = new Store(":memory:", undefined, {
    now: () => now,
    id: () => "synthetic-session",
  });
  try {
    store.viewerMemory.write("one", "standard", state, 200);
    assert.equal(store.viewerMemory.read("two", "standard"), undefined);
    assert.equal(store.viewerMemory.read("one", "other"), undefined);
    now = 150;
    assert.equal(
      store.viewerMemory.write("one", "standard", state, 300).revision,
      2,
    );
    now = 201;
    assert.equal(store.viewerMemory.read("one", "standard"), undefined);
    store.viewerMemory.write("one", "standard", state, 300);
    store.emit("context_invalidated");
    assert.deepEqual(store.viewerMemory.list(), []);
  } finally {
    store.db.close();
  }
});
test("provider requests use stable cache keys, strict tools and sanitized inspection continuation", () => {
  const request = {
    ...input,
    tools: viewerTools,
    continuation: [
      {
        type: "reasoning" as const,
        id: "rs_fixture",
        summary: [],
        encrypted_content: "opaque-secret",
      },
      call("wait", {}),
      { type: "function_call_output" as const, call_id: "wait", output: "ok" },
    ],
  };
  const body = modelRequest(request);
  assert("tools" in body);
  assert.equal(body.prompt_cache_key, "synthetic-cache");
  assert.equal(body.tool_choice, "required");
  assert(!JSON.stringify(body).includes("You have no tools"));
  assert(JSON.stringify(body).includes("opaque-secret"));
  assert(
    !JSON.stringify(inspectedModelRequest(request)).includes("opaque-secret"),
  );
});
test("Responses API and ChatGPT streams accept tool-only output and account for cached input", async () => {
  const output = [call("wait", {})];
  const response = {
    status: "completed",
    output,
    usage: {
      input_tokens: 2048,
      output_tokens: 25,
      input_tokens_details: { cached_tokens: 1024 },
    },
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
        ),
      );
      c.close();
    },
  });
  const streamed = await readResponsesStream(
    stream,
    new AbortController().signal,
    true,
  );
  assert.equal(streamed.cachedInputTokens, 1024);
  assert.deepEqual(streamed.toolCalls, output);
  const oldKey = process.env.OPENAI_API_KEY,
    oldModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  try {
    const model = openaiModel(
      { maxInputTokens: 4096, maxOutputTokens: 100 },
      undefined,
      async (url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.tools.length, 4);
        return Response.json(
          String(url).endsWith("input_tokens")
            ? { input_tokens: 2048 }
            : response,
        );
      },
    );
    const result = await model(
      { ...input, tools: viewerTools },
      new AbortController().signal,
    );
    assert.equal(result.cachedInputTokens, 1024);
    assert.deepEqual(result.toolCalls, output);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = oldModel;
  }
});
