import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPipelineProfile,
  applyPipelineProfile,
  pipelineCards,
  pipelineProfileSchema,
} from "../packages/infrastructure/reactions/pipeline-profile.ts";
import { configSchema } from "../packages/config.ts";
import { ExperimentRuntime } from "../packages/infrastructure/experiments/runtime.ts";
import { scenarioSchema } from "../packages/infrastructure/experiments/scenario.ts";
import {
  runExperiment,
  type ExperimentOptions,
} from "../packages/infrastructure/experiments/runner.ts";
import { fixtureModel } from "../packages/infrastructure/experiments/models.ts";
import { renderExperimentReport } from "../packages/infrastructure/experiments/report.ts";
import { modelMessages } from "../packages/infrastructure/reactions/model-messages.ts";
import { createBroadcastCast } from "../packages/infrastructure/cast/runtime.ts";
import { Store } from "../packages/storage.ts";

function options(
  overrides: Partial<ExperimentOptions> = {},
): ExperimentOptions {
  return {
    pipeline: loadPipelineProfile("experiments/profiles/baseline.json"),
    scenario: scenarioSchema.parse({
      schemaVersion: 1,
      id: "fixture",
      description: "Synthetic input",
      topic: "선택 이유와 방법의 차이",
      durationMs: 90000,
      events: [
        {
          kind: "speech",
          atMs: 1000,
          text: "선택 이유와 방법의 차이를 어떻게 생각하세요?",
        },
        { kind: "speech", atMs: 45000, text: "다른 방법을 먼저 시도할까요?" },
      ],
    }),
    directory: process.cwd(),
    mode: "replay",
    seed: 1,
    provider: "fixture",
    modelName: "fixture",
    model: fixtureModel,
    ...overrides,
  };
}
test("paired replay is deterministic and uses live publication/review owners", async () => {
  const first = await runExperiment(options());
  const second = await runExperiment(options());
  assert(first.summary.published > 0);
  assert(
    first.calls.some((c) => (c.input as { reviewDraft?: string }).reviewDraft),
  );
  assert(first.attempts.some((a) => a.state === "published"));
  const normalize = (r: typeof first) => ({
    personas: r.personas,
    messages: r.messages,
    calls: r.calls.map(({ elapsedMs: _, ...c }) => c),
    diagnostics: r.diagnostics,
    timeline: r.timeline,
  });
  assert.deepEqual(normalize(first), normalize(second));
});
test("no evidence makes no calls and publishes nothing", async () => {
  const opt = options();
  opt.scenario.events = [];
  const r = await runExperiment(opt);
  assert.equal(r.calls.length, 0);
  assert.equal(r.summary.published, 0);
});
test("zero propensity is respected without a forced-response mode", async () => {
  const opt = options();
  opt.pipeline.profile.personas = Array.from({ length: 6 }, () => ({
    participation: { base_propensity: 0 },
  }));
  const r = await runExperiment(opt);
  assert.equal(r.calls.length, 0);
  assert(
    r.diagnostics.some(
      (d) => (d as { event: string }).event === "cast_selection_skipped",
    ),
  );
});
test("review rejection and model failure are visible separately from final chat", async () => {
  const r = await runExperiment(
    options({
      model: async (input, signal) => {
        const result = await fixtureModel(input, signal);
        if (input.reviewDraft)
          result.decision = { ...result.decision, action: "skip", text: null };
        return result;
      },
    }),
  );
  assert(r.calls.length > 0);
  assert.equal(r.summary.published, 0);
  assert(r.attempts.some((a) => a.reason === "review_rejected"));
  const failed = await runExperiment(
    options({
      model: async () => {
        throw Error("provider unavailable");
      },
    }),
  );
  assert(failed.calls.some((c) => c.error));
  assert.equal(failed.summary.published, 0);
});
test("draft mode shares review and metering while bypassing participation selection", async () => {
  const opt = options({ mode: "draft" });
  opt.pipeline.profile.personas = Array.from({ length: 6 }, () => ({
    participation: { base_propensity: 0 },
  }));
  const result = await runExperiment(opt);
  assert.equal(result.calls.length, 2);
  assert.equal(result.usage.calls, 2);
  assert.equal(result.summary.published, 0);
  assert.equal((result.drafts[0] as { kind: string }).kind, "candidate");
});
test("replay generation and review remain uncapped", async () => {
  const result = await runExperiment(options({}));
  assert(result.calls.length >= 2);
  assert(result.summary.published > 0);
  assert(!result.attempts.some((a) => a.reason === "budget_exhausted"));
});
test("transcript limit applies to actual model inputs", async () => {
  const opt = options({ mode: "draft" });
  opt.scenario.durationMs = 15000;
  opt.scenario.events = Array.from({ length: 10 }, (_, i) => ({
    kind: "speech",
    atMs: (i + 1) * 1000,
    text: `청크 ${i}`,
  }));
  opt.pipeline.profile.ai.transcriptLimit = 3;
  const result = await runExperiment(opt);
  const input = result.calls[0].input as {
    transcripts: Array<{ text: string }>;
  };
  assert.deepEqual(
    input.transcripts.map((t) => t.text),
    ["청크 7", "청크 8", "청크 9"],
  );
});
test("profile resolves relative prompts, fingerprints content and preserves live cast on resume", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-profile-"));
  try {
    const path = join(dir, "profile.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        id: "custom",
        revision: 2,
        prompts: { answer: "answer.md", review: "review.md" },
        personas: [{ voice: { register: "변경한 말투" } }, {}, {}, {}, {}, {}],
        ai: { reviewDraft: false },
      }),
    );
    writeFileSync(
      join(dir, "answer.md"),
      "Answer {{persona_style}} {{visual_instruction}}",
    );
    writeFileSync(join(dir, "review.md"), "Review custom");
    const p = loadPipelineProfile(path);
    assert.equal(
      applyPipelineProfile(configSchema.parse({}), p).ai.reviewDraft,
      false,
    );
    const store = new Store(":memory:");
    try {
      const cast = createBroadcastCast(store, () => "fixture", {
        cards: pipelineCards(p),
      });
      cast.prepare();
      assert.equal(
        store.personaRuntime()!.members[0].snapshot.voice.register,
        "변경한 말투",
      );
      const before = store.personaRuntime();
      createBroadcastCast(store, () => "changed topic").prepare();
      assert.deepEqual(store.personaRuntime(), before);
    } finally {
      store.close();
    }
    const input = {
      frames: [],
      messages: [],
      persona: { name: "x", style: "style" },
      description: "fixture",
    };
    assert.equal(
      modelMessages({ ...input, reviewDraft: "draft" }, p.prompts)[0].content,
      "Review custom",
    );
    writeFileSync(join(dir, "answer.md"), "Changed prompt");
    assert.notEqual(loadPipelineProfile(path).digest, p.digest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("schemas reject unknown controls and invalid event order", () => {
  assert.equal(
    pipelineProfileSchema.safeParse({
      schemaVersion: 1,
      id: "x",
      revision: 1,
      ai: { forcedResponse: true },
    }).success,
    false,
  );
  const opt = options();
  opt.scenario.events.reverse();
  assert.equal(scenarioSchema.safeParse(opt.scenario).success, false);
});
test("virtual publication delays execute in order and can be canceled", () => {
  const runtime = new ExperimentRuntime(1),
    values: number[] = [];
  const base = runtime.now;
  runtime.clock.delay(() => values.push(2), 200);
  const canceled = runtime.clock.delay(() => values.push(9), 50);
  runtime.clock.cancelDelay(canceled);
  runtime.clock.delay(() => values.push(1), 100);
  runtime.advance(base + 200);
  assert.deepEqual(values, [1, 2]);
});
test("comparison report escapes untrusted fixture text and retains failure details", async () => {
  const opt = options();
  opt.scenario.description = '</pre><script>alert("x")</script>';
  opt.scenario.expectations.maxPublished = 0;
  const result = await runExperiment(opt);
  assert(result.summary.failedChecks > 0);
  const html = renderExperimentReport([result]);
  assert(!html.includes(opt.scenario.description));
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes('id="filter"'));
});

test("inspection uses the scenario image and the production second-generation path", async () => {
  const opt = options({
    mode: "draft",
    directory: join(process.cwd(), "experiments/scenarios"),
  });
  opt.scenario.durationMs = 4000;
  opt.scenario.events = [
    { kind: "frame", atMs: 0, file: "screen.svg" },
    { kind: "speech", atMs: 1000, text: "화면의 글자를 읽어 주세요." },
  ];
  opt.model = async (input, signal) => {
    if (!input.frames.length)
      return {
        decision: {
          action: "inspect",
          text: null,
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: [],
          evidenceTranscriptIds: [],
        },
      };
    return fixtureModel(input, signal);
  };
  const result = await runExperiment(opt);
  assert.equal(result.calls.length, 3);
  assert.equal((result.drafts[0] as { kind: string }).kind, "candidate");
  assert(
    JSON.stringify(result.calls[1].request).includes("data:image/jpeg;base64,"),
  );
  assert(
    result.timeline.some((t) => t.phase === "generating_draft_with_frame"),
  );
});

test("draft validation failure is a failed run, even when the provider returned normally", async () => {
  const result = await runExperiment(
    options({
      mode: "draft",
      model: async () => ({
        decision: {
          action: "say",
          text: "Invalid citation",
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: ["missing"],
          evidenceTranscriptIds: [],
        },
      }),
    }),
  );
  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.state, "draft_failed");
});

test("server composition consumes the same versioned profile without modifying source config", async () => {
  const { createApp } = await import("../apps/server/app.ts");
  const dir = mkdtempSync(join(tmpdir(), "experiment-server-"));
  try {
    const path = join(dir, "profile.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        id: "server-test",
        revision: 1,
        ai: { visualMode: "on_request", transcriptLimit: 3 },
        personas: [
          { voice: { register: "프로필에서 지정한 말투" } },
          {},
          {},
          {},
          {},
          {},
        ],
      }),
    );
    const config = configSchema.parse({
      database: ":memory:",
      ai: { pipelineProfile: path },
    });
    const instance = await createApp(config, {
      demo: true,
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(dir, "chatgpt"),
    });
    try {
      assert.equal(instance.scheduler.config.ai.transcriptLimit, 3);
      assert.equal(config.ai.transcriptLimit, 10);
      instance.personas.prepare();
      assert.equal(
        instance.store.personaRuntime()!.members[0].snapshot.voice.register,
        "프로필에서 지정한 말투",
      );
      assert(
        instance.store.db
          .prepare(
            "SELECT action FROM audit_events WHERE action LIKE 'pipeline.loaded:server-test@1:%'",
          )
          .get(),
      );
    } finally {
      await instance.app.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
