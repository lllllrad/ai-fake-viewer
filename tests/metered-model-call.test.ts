import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import {
  callMeteredModel,
  type ModelCallPolicy,
} from "../packages/application/reactions/model-call.ts";
const policy: ModelCallPolicy = {
  provider: "openai_api",
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 8,
  priceCheckedAt: "2026-01-01",
  maxInputTokens: 1000,
  maxOutputTokens: 100,
  maxCalls: 3,
  maxUsd: 1,
};
const decision = {
  action: "skip",
  text: null,
  replyToMessageId: null,
  evidenceMessageIds: [],
  evidenceFrameIds: [],
  evidenceTranscriptIds: [],
};
const input = {
  frames: [],
  newMessages: [{ text: "PRIVATE_FIXTURE" }],
  newTranscripts: [{ capturedAt: 20, text: "PRIVATE_SPEECH" }],
};

test("model invocation follows durable reservation and settles actual usage without raw diagnostics", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const traces: unknown[] = [];
  let clock = 0;
  await callMeteredModel({
    input,
    signal: new AbortController().signal,
    policy,
    usage: store,
    now: () => clock++,
    trace: (event, details) => traces.push({ event, details }),
    model: async () => {
      assert.equal(store.usage().calls, 1);
      assert.equal(store.usage().reservedUsd, 0.0028);
      return { decision, inputTokens: 100, outputTokens: 20 };
    },
  });
  assert.equal(store.usage().reservedUsd, 0.00036);
  assert.equal(store.usage().inputTokens, 100);
  assert(!JSON.stringify(traces).includes("PRIVATE"));
  assert.equal(traces.length, 2);
});

test("budget rejection and prior cancellation never invoke the provider", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const options = {
    input,
    signal: new AbortController().signal,
    policy: { ...policy, maxCalls: 0 },
    usage: store,
    now: () => 0,
    trace: () => {},
    model: async () => {
      assert.fail("provider must not run");
      return { decision };
    },
  };
  await assert.rejects(callMeteredModel(options), /budget_exhausted/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    callMeteredModel({ ...options, signal: controller.signal, policy }),
    { name: "AbortError" },
  );
  assert.equal(store.usage().calls, 0);
});

test("ambiguous provider failure retains its call and monetary reservation", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  await assert.rejects(
    callMeteredModel({
      input,
      signal: new AbortController().signal,
      policy,
      usage: store,
      now: () => 0,
      trace: () => {},
      model: async () => {
        throw new Error("fixture disconnect");
      },
    }),
    /fixture disconnect/,
  );
  assert.equal(store.usage().calls, 1);
  assert.equal(store.usage().reservedUsd, 0.0028);
  assert.equal(
    store.db.prepare("SELECT status FROM model_usage").get()?.status,
    "reserved",
  );
});

for (const tokens of [undefined, -10, NaN, Infinity, 0.5])
  test(`invalid or absent token usage preserves the conservative reservation: ${tokens}`, async (t) => {
    const store = new Store(":memory:");
    t.after(() => store.close());
    await callMeteredModel({
      input,
      signal: new AbortController().signal,
      policy,
      usage: store,
      now: () => 0,
      trace: () => {},
      model: async () => ({ decision, inputTokens: tokens, outputTokens: 1 }),
    });
    assert.equal(store.usage().reservedUsd, 0.0028);
    assert.equal(store.usage().inputTokens, null);
  });

test("subscription usage never receives API monetary pricing", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  await callMeteredModel({
    input,
    signal: new AbortController().signal,
    policy: { ...policy, provider: "chatgpt_subscription" },
    usage: store,
    now: () => 0,
    trace: () => {},
    model: async () => ({ decision, inputTokens: 100, outputTokens: 20 }),
  });
  assert.equal(
    store.db.prepare("SELECT reserved FROM model_usage").get()?.reserved,
    null,
  );
  assert.equal(store.usage().inputTokens, 100);
});

test("late settlement cannot mutate another broadcast's reservation", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const id = store.reserve(3, 1, 0.5)!;
  const session = store.sessionId;
  store.sessionId = "another-broadcast";
  store.settle(id, 10, 2, 0.001);
  store.sessionId = session;
  assert.equal(store.usage().reservedUsd, 0.5);
  assert.equal(store.usage().inputTokens, null);
});
