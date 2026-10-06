import { test } from "node:test";
import assert from "node:assert/strict";
import { configSchema } from "../packages/config.ts";
import { DecisionGate } from "../packages/gate.ts";
import { Scheduler } from "../packages/infrastructure/reactions/scheduler.ts";
import { Store } from "../packages/storage.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import type { Transcriber } from "../packages/infrastructure/inputs/speech-input.ts";
import type { ModelInput } from "../packages/application/reactions/model-port.ts";

const response = (noul: number) =>
  Response.json({
    model: "jev-1.13.0",
    answers: { should_respond: { type: "noul", noul } },
  });
const input: ModelInput<Buffer> = {
  frames: [],
  messages: [],
  transcripts: [
    { id: "speech", capturedAt: Date.now(), text: "화면을 봐 주세요" },
  ],
  persona: { name: "Orbit", style: "Brief Korean spectator" },
  description: "Live broadcast",
};
function harness(
  request: typeof fetch,
  options: {
    enabled?: boolean;
    demo?: boolean;
    maxRequests?: number;
    threshold?: number;
  } = {},
) {
  const config = configSchema.parse({
    ai: {
      visualMode: "on_request",
      gate: {
        threshold: options.threshold ?? 0.8,
        enabled: options.enabled ?? true,
        maxRequests: options.maxRequests ?? 10,
      },
      pacing: { minSeconds: 20, maxSeconds: 20 },
    },
  });
  const store = new Store(":memory:");
  const capture = new Capture(config.capture, true);
  const transcripts = [{ ...input.transcripts![0], capturedAt: Date.now() }];
  const transcriber = {
    recent: () => [...transcripts],
    has: (id: string) => transcripts.some((t) => t.id === id),
  } as Transcriber;
  let modelCalls = 0;
  const gate = new DecisionGate(config.ai.gate, request);
  const scheduler = new Scheduler(
    store,
    capture,
    config,
    async () => {
      modelCalls++;
      return {
        decision: {
          action: "skip",
          text: null,
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: [],
          evidenceTranscriptIds: [],
        },
      };
    },
    options.demo ?? false,
    () => true,
    transcriber,
    gate,
  );
  scheduler.state = "running";
  return {
    config,
    store,
    capture,
    transcripts,
    scheduler,
    gate,
    calls: () => modelCalls,
    close: () => {
      scheduler.stop();
      store.close();
    },
  };
}

test("Jev config is opt-in and rejects incompatible video mode or invalid limits", () => {
  assert.equal(configSchema.parse({}).ai.gate.enabled, false);
  assert.equal(configSchema.parse({ ai: {} }).ai.gate.enabled, false);
  assert.throws(
    () => configSchema.parse({ ai: { gate: { enabled: true } } }),
    /on_request/,
  );
  for (const gate of [
    { threshold: -1 },
    { threshold: 1.1 },
    { maxRequests: 0 },
    { timeoutMs: 0 },
    { model: " " },
    { typo: true },
  ])
    assert.equal(configSchema.safeParse({ ai: { gate } }).success, false);
});

test("Jev uses the documented text-only API and inclusive probability threshold", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture-typesafe-key";
  try {
    let calls = 0;
    const gate = new DecisionGate(
      configSchema.parse({ ai: { gate: { threshold: 0.5 } } }).ai.gate,
      (async (url, init) => {
        calls++;
        assert.equal(url, "https://api.typesafe.ai/v1/systemone");
        assert.equal(init!.method, "POST");
        assert.equal(
          (init!.headers as Record<string, string>).Authorization,
          "Bearer fixture-typesafe-key",
        );
        const body = JSON.parse(init!.body as string);
        assert.equal(body.model, "jev-latest");
        assert.equal(body.questions.should_respond.type, "noul");
        assert.equal(body.state.transcripts[0].text, "화면을 봐 주세요");
        assert.equal(body.state.frames, undefined);
        assert.equal(body.state.transcripts[0].id, undefined);
        assert.equal(body.state.messages[0].id, undefined);
        assert.equal(body.state.messages[0].text.length, 1000);
        assert(!String(init!.body).includes("secret-image"));
        return response(calls === 1 ? 0.49 : 0.5);
      }) as typeof fetch,
    );
    const state = {
      ...input,
      messages: [
        { id: "private-id", speaker: "viewer-1", text: "x".repeat(2000) },
      ],
      frames: [{ bytes: Buffer.from("secret-image") }],
    } as ModelInput<Buffer>;
    assert.equal(await gate.allow(state, new AbortController().signal), true);
    assert.equal(await gate.allow(state, new AbortController().signal), false);
    assert.equal(gate.filtered, 1);
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("gate blocks answer-model spending, deduplicates input, and enforces its separate cap", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture";
  const h = harness((async () => response(0.1)) as typeof fetch, {
    maxRequests: 1,
    threshold: 0.05,
  });
  try {
    await h.scheduler.tick();
    assert.equal(h.gate.requests, 1);
    assert.equal(h.calls(), 0);
    assert.equal(h.store.usage().calls, 0);
    h.scheduler.lastAttempt = 0;
    await h.scheduler.tick();
    assert.equal(h.gate.requests, 1);
    h.transcripts[0].id = "new-speech";
    await h.scheduler.tick();
    assert.equal(h.gate.requests, 1);
    assert.equal(h.scheduler.state, "gate_budget_exhausted");
    assert.equal(h.calls(), 0);
  } finally {
    h.close();
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("allowed input reaches model and unauthorized platform text stays out of Jev", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture";
  let sent = "";
  const h = harness(
    (async (_url, init) => {
      sent = String(init!.body);
      return response(0.9);
    }) as typeof fetch,
    { threshold: 0.95 },
  );
  try {
    h.store.grantConsent("youtube", "channel", "private-youtube");
    h.store.grantConsent("chzzk", "channel", "private-chzzk");
    h.store.ingestBatch([
      {
        platform: "youtube",
        channel: "channel",
        author: "private-youtube",
        name: "Private YouTube",
        text: "UNAPPROVED",
      },
      {
        platform: "chzzk",
        channel: "channel",
        author: "private-chzzk",
        name: "Private CHZZK",
        text: "APPROVED",
      },
    ]);
    h.scheduler.lastAttempt = 0;
    await h.scheduler.tick();
    assert.equal(h.calls(), 1);
    assert.equal(h.store.usage().calls, 1);
    assert(sent.includes("APPROVED"));
    assert(sent.includes("UNAPPROVED"));
    for (const forbidden of [
      "private-chzzk",
      "Private CHZZK",
      "private-youtube",
    ])
      assert(!sent.includes(forbidden));
  } finally {
    h.close();
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("disabled and demo gates make no external gate request", async () => {
  for (const options of [{ enabled: false }, { demo: true }]) {
    const h = harness(
      (async () => {
        assert.fail("unexpected gate request");
      }) as typeof fetch,
      options,
    );
    try {
      await h.scheduler.tick();
      assert.equal(h.calls(), 1);
      assert.equal(h.gate.requests, 0);
    } finally {
      h.close();
    }
  }
});

test("provider errors and malformed probabilities skip generation without spending model budget", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture";
  try {
    for (const value of [
      new Response("limited", { status: 429 }),
      Response.json({}),
      response(2),
      response(Number.NaN),
      new Response("invalid"),
      new Response("x".repeat(8193)),
    ]) {
      const h = harness((async () => value) as typeof fetch);
      try {
        await h.scheduler.tick();
        assert.equal(h.calls(), 0);
        assert.equal(h.store.usage().calls, 0);
        assert.equal(h.gate.state, "provider_error");
        assert.equal(h.gate.errors, 1);
        assert.equal(h.scheduler.state, "running");
      } finally {
        h.close();
      }
    }
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("stop discards late gate results and evidence removed during gating cannot reach the model", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture";
  try {
    for (const stop of [true, false]) {
      let finish!: (value: Response) => void;
      const h = harness(
        (async () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })) as typeof fetch,
      );
      try {
        const tick = h.scheduler.tick();
        if (stop) h.scheduler.stop();
        else h.transcripts.length = 0;
        finish(response(0.9));
        await tick;
        assert.equal(h.calls(), 0);
        assert.equal(h.store.usage().calls, 0);
      } finally {
        h.close();
      }
    }
  } finally {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("gate timeout skips the answer model", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture";
  const h = harness(
    (async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(init!.signal!.reason),
          { once: true },
        );
      })) as typeof fetch,
  );
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    h.config.ai.gate.timeoutMs = 100;
    await h.scheduler.tick();
    assert.equal(h.calls(), 0);
    assert.equal(h.gate.state, "provider_error");
  } finally {
    clearTimeout(keepAlive);
    h.close();
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("Jev is optional and does not require a second policy enable flag", () => {
  const h = harness(fetch);
  try {
    h.scheduler.start();
    assert.equal(h.scheduler.state, "running");
  } finally {
    h.close();
  }
});

test("Jev runs once before a text decision and its subsequent masked-frame inspection", async () => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture";
  const h = harness((async () => response(0.9)) as typeof fetch, {
    threshold: 0.95,
  });
  const frameCounts: number[] = [];
  h.capture.add(
    {
      capturedAt: Date.now(),
      width: 8,
      height: 8,
      bytes: Buffer.from("masked"),
    },
    "demo",
  );
  h.scheduler.model = async (state) => {
    frameCounts.push(state.frames.length);
    return {
      decision: {
        action: state.frames.length ? "skip" : "inspect",
        text: null,
        replyToMessageId: null,
        evidenceFrameIds: [],
        evidenceMessageIds: [],
        evidenceTranscriptIds: [],
      },
    };
  };
  try {
    h.scheduler.lastAttempt = 0;
    await h.scheduler.tick();
    assert.deepEqual(frameCounts, [0, 1]);
    assert.equal(h.gate.requests, 1);
    assert.equal(h.store.usage().calls, 2);
  } finally {
    h.close();
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test("exhausted answer-model call budget does not spend a gate request", async () => {
  const h = harness((async () => {
    assert.fail("gate request after model budget exhaustion");
  }) as typeof fetch);
  try {
    h.config.ai.maxCalls = 1;
    h.store.reserve(1, null, null);
    await h.scheduler.tick();
    assert.equal(h.scheduler.state, "budget_exhausted");
    assert.equal(h.gate.requests, 0);
    assert.equal(h.calls(), 0);
  } finally {
    h.close();
  }
});
