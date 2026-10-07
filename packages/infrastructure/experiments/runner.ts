import { callMeteredModel } from "../../application/reactions/model-call.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { Store } from "../../storage.ts";
import { configSchema } from "../../config.ts";
import { reactionPipelines } from "../../application/reactions/pipelines.ts";
import { TimingGate } from "../../application/reactions/timing-gate.ts";
import { type DraftOutcome } from "../../application/reactions/draft-review.ts";
import { personaStyle } from "../../application/reactions/persona-style.ts";
import type {
  Model,
  ModelInput,
} from "../../application/reactions/model-port.ts";
import { ScreenContext } from "../../application/inputs/screen-context.ts";
import { selectEvidenceWindow } from "../../domain/reactions/evidence.ts";
import { createBroadcastCast } from "../cast/runtime.ts";
import { generationIssue } from "../../model-errors.ts";
import {
  applyPipelineProfile,
  pipelineCards,
  type LoadedPipeline,
} from "../reactions/pipeline-profile.ts";
import { modelMessages } from "../reactions/model-messages.ts";
import { scenarioSchema, type Scenario } from "./scenario.ts";
import { ExperimentRuntime } from "./runtime.ts";

export interface ExperimentOptions {
  pipeline: LoadedPipeline;
  scenario: Scenario;
  directory: string;
  seed: number;
  mode: "draft" | "replay";
  provider: string;
  modelName: string;
  model: Model<Buffer>;
  maxCalls: number;
  personaIndex?: number;
}
/** Synthetic evidence only. No platform connectors, live DB, or account writes. */
export async function runExperiment(options: ExperimentOptions) {
  const scenario = scenarioSchema.parse(options.scenario);
  if (
    !Number.isInteger(options.maxCalls) ||
    options.maxCalls < 1 ||
    options.maxCalls > 1000
  )
    throw Error("Invalid call limit");
  const implementation = reactionPipelines.get(
    options.pipeline.profile.ai.pipelineType ?? "standard",
  );
  const runtime = new ExperimentRuntime(options.seed);
  const base = runtime.now;
  const store = new Store(":memory:", undefined, {
    now: () => runtime.now,
    id: runtime.id,
  });
  const config = applyPipelineProfile(
    configSchema.parse({
      ai: {
        visualMode: "on_request",
        provider:
          options.provider === "chatgpt_subscription"
            ? "chatgpt_subscription"
            : "openai_api",
        description: scenario.topic,
        maxCalls: options.maxCalls,
      },
    }),
    options.pipeline,
  );
  const screen = new ScreenContext<Buffer>({
    now: () => runtime.now,
    id: runtime.id,
    digest: (bytes) => runtime.hash(bytes.toString("base64")),
  });
  const speech = {
    recent: () => store.transcripts.recent(),
    has: (id: string) => store.transcripts.recent().some((t) => t.id === id),
  };
  const cast = createBroadcastCast(store, () => scenario.topic, {
    now: () => runtime.now,
    id: runtime.id,
    cards: pipelineCards(options.pipeline, {
      id: runtime.id,
      index: (length) => Math.floor(runtime.random() * length),
    }),
    researchBasis: `experiment:${options.pipeline.digest}`,
  });
  const calls: Array<{
    atMs: number;
    elapsedMs: number;
    input: unknown;
    request: ReturnType<typeof modelMessages>;
    result?: unknown;
    error?: string;
  }> = [];
  const diagnostics: unknown[] = [];
  const timeline: Array<{ atMs: number; phase: string; state: string }> = [];
  const drafts: Array<
    DraftOutcome<ModelInput<Buffer>> | { kind: "failed"; reason: string }
  > = [];
  const model: Model<Buffer> = async (input, signal) => {
    if (calls.length >= options.maxCalls) throw Error("budget_exhausted");
    const started = performance.now();
    // Copy before the live coordinator retires mutable context at lease end.
    const call: (typeof calls)[number] = {
      atMs: runtime.now - base,
      elapsedMs: 0,
      input: structuredClone({
        ...input,
        frames: input.frames.map((f) => ({ ...f, bytes: undefined })),
      }),
      request: modelMessages(input, options.pipeline.prompts),
    };
    calls.push(call);
    try {
      const result = await options.model(
        input,
        AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      );
      call.result = structuredClone(result);
      return result;
    } catch (error) {
      call.error = generationIssue(error).code;
      throw error;
    } finally {
      call.elapsedMs = Math.round(performance.now() - started);
    }
  };
  const coordinator = implementation.create<Buffer, number>(
    store,
    screen,
    config,
    model,
    false,
    () => true,
    speech,
    new TimingGate(config.ai.gate, {
      ensureReady() {},
      async evaluate() {
        throw Error("Timing provider is disabled in experiments");
      },
    }),
    runtime.random,
    {
      now: () => runtime.now,
      id: runtime.id,
      hash: runtime.hash,
      clock: runtime.clock,
      issue: (error) => ({ issue: generationIssue(error), details: {} }),
    },
  );
  coordinator.onDiagnostic = (entry) =>
    diagnostics.push({ ...entry, at: entry.at - base });
  const ingest = async (event: Scenario["events"][number]) => {
    if (event.kind === "speech")
      store.transcripts.record({
        id: runtime.id(),
        capturedAt: runtime.now,
        text: event.text,
      });
    if (event.kind === "chat") {
      store.grantConsent("youtube", "fixture", event.author);
      store.ingestBatch([
        {
          platform: "youtube",
          channel: "fixture",
          author: event.author,
          name: event.author,
          text: event.text,
          sourceId: runtime.id(),
          publishedAt: runtime.now,
        },
      ]);
    }
    if (event.kind === "withdraw")
      store.revokeParticipant("youtube", "fixture", event.author);
    if (event.kind === "frame") {
      const bytes = readFileSync(resolve(options.directory, event.file));
      if (bytes.length > 4 * 1024 * 1024)
        throw Error("Fixture image exceeds 4 MiB");
      const converted = await sharp(bytes, { limitInputPixels: 16000000 })
        .resize({
          width: 1280,
          height: 720,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg()
        .toBuffer({ resolveWithObject: true });
      screen.accept(
        {
          capturedAt: runtime.now,
          width: converted.info.width,
          height: converted.info.height,
          bytes: converted.data,
        },
        "demo",
        "fixture",
      );
    }
  };
  try {
    cast.prepare();
    const personas = structuredClone(store.personaRuntime()!.members);
    let nextEvent = 0;
    // Start only after time-zero fixtures are present (continuous video readiness).
    while (scenario.events[nextEvent]?.atMs === 0)
      await ingest(scenario.events[nextEvent++]);
    if (options.mode === "replay") {
      coordinator.start();
      while (coordinator.busy)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const times = [
      ...new Set([
        0,
        scenario.durationMs,
        ...scenario.events.map((e) => e.atMs),
        ...Array.from(
          { length: Math.floor(scenario.durationMs / 1000) },
          (_, i) => (i + 1) * 1000,
        ),
      ]),
    ].sort((a, b) => a - b);
    for (const atMs of times) {
      runtime.advance(base + atMs);
      while (
        nextEvent < scenario.events.length &&
        scenario.events[nextEvent].atMs <= atMs
      )
        await ingest(scenario.events[nextEvent++]);
      if (options.mode === "replay") {
        await coordinator.tick();
        const last = timeline.at(-1);
        if (
          last?.phase !== coordinator.phase ||
          last?.state !== coordinator.state
        )
          timeline.push({
            atMs,
            phase: coordinator.phase,
            state: coordinator.state,
          });
      }
    }
    if (options.mode === "draft") {
      const evidence = selectEvidenceWindow({
        now: runtime.now,
        windowMs: config.ai.contextWindowSeconds * 1000,
        transcriptLimit: config.ai.transcriptLimit,
        recent: store.snapshot().messages,
        messages: store.context(["youtube"]),
        transcripts: speech.recent(),
        allowedPlatforms: ["youtube"],
        processedTranscriptIds: new Set(),
        processedMessageVersions: new Map(),
      });
      const member = personas[options.personaIndex ?? 0];
      if (!member) throw Error("Invalid persona index");
      const input: ModelInput<Buffer> = {
        frames:
          config.ai.visualMode === "continuous"
            ? screen.recent().slice(-1)
            : [],
        messages: evidence.messages,
        newMessages: evidence.newMessages,
        transcripts: evidence.transcripts,
        newTranscripts: evidence.newTranscripts,
        persona: {
          name: member.displayName,
          style: personaStyle(member.snapshot),
        },
        description: scenario.topic,
      };
      try {
        drafts.push(
          await implementation.draft({
            input,
            signal: AbortSignal.timeout(90000),
            isCurrent: () => true,
            inspectAllowed: config.ai.visualMode === "on_request",
            review: config.ai.reviewDraft,
            latestFrames: () => screen.recent(),
            hasTranscript: speech.has,
            model: (input, signal) =>
              callMeteredModel({
                input,
                signal,
                policy: config.ai,
                usage: store,
                model,
                now: () => runtime.now,
                trace: (event, details) => diagnostics.push({ event, details }),
              }),
            active() {},
            phase: (phase) =>
              timeline.push({
                atMs: runtime.now - base,
                phase,
                state: "draft",
              }),
            trace: (event, details) => diagnostics.push({ event, details }),
          }),
        );
      } catch (error) {
        drafts.push({ kind: "failed", reason: generationIssue(error).code });
      }
    }
    const messages = store
      .snapshot()
      .messages.filter((m) => m?.attribution === "experiment");
    const checks = [];
    if (options.mode === "replay") {
      const expected = scenario.expectations;
      if (expected.minPublished !== undefined)
        checks.push({
          name: "minPublished",
          passed: messages.length >= expected.minPublished,
        });
      if (expected.maxPublished !== undefined)
        checks.push({
          name: "maxPublished",
          passed: messages.length <= expected.maxPublished,
        });
      for (const text of expected.forbiddenText)
        checks.push({
          name: `forbiddenText:${text}`,
          passed: !messages.some((m) => m!.text.includes(text)),
        });
    }
    const attempts = store.db
      .prepare(
        "SELECT state,reason,result,model_manifest FROM persona_reaction_attempts ORDER BY rowid",
      )
      .all();
    const usage = store.usage();
    return {
      schemaVersion: 1,
      mode: options.mode,
      seed: options.seed,
      provider: options.provider,
      model: options.modelName,
      pipeline: options.pipeline,
      implementation: {
        id: implementation.id,
        revision: implementation.revision,
      },
      effectiveAi: config.ai,
      scenario,
      personas,
      calls,
      diagnostics,
      timeline,
      drafts,
      attempts,
      messages,
      usage,
      checks,
      summary: {
        calls: calls.length,
        published: messages.length,
        skipped: coordinator.skips,
        rejected: coordinator.rejects,
        failedChecks: checks.filter((c) => !c.passed).length,
        modelElapsedMs: calls.reduce((sum, c) => sum + c.elapsedMs, 0),
        state:
          options.mode === "draft"
            ? drafts.some((d) => d.kind === "failed")
              ? "draft_failed"
              : "draft_completed"
            : coordinator.state,
        failed:
          calls.some((c) => c.error) ||
          drafts.some((d) => d.kind === "failed") ||
          (options.mode === "replay" && coordinator.state !== "running"),
      },
    };
  } finally {
    coordinator.stop();
    store.close();
  }
}
export type ExperimentResult = Awaited<ReturnType<typeof runExperiment>>;
