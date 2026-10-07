import { viewerInspectionSchema } from "../../contracts/reaction-inspection.ts";
import { z } from "zod";
import { restoreExperiment } from "./restore.ts";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { Store } from "../../storage.ts";
import { configSchema } from "../../config.ts";
import {
  reactionPipelines,
  type ReactionEngine,
  type ReactionPipeline,
} from "../../application/reactions/pipelines.ts";
import { TimingGate } from "../../application/reactions/timing-gate.ts";
import type { Model } from "../../application/reactions/model-port.ts";
import { createBroadcastCast } from "../cast/runtime.ts";
import {
  applyPipelineProfile,
  pipelineCards,
  pipelineProfileSchema,
  type LoadedPipeline,
} from "../reactions/pipeline-profile.ts";
import {
  inspectedModelRequest,
  inspectedModelResult,
} from "../reactions/model-request.ts";
import { generationIssue } from "../../model-errors.ts";
import {
  experimentTraceSchema,
  type ExperimentStart,
  type ExperimentSession,
  type ExperimentTrace,
} from "../../contracts/interactive-experiment.ts";

export class ExperimentError extends Error {
  constructor(
    message: string,
    public statusCode = 409,
  ) {
    super(message);
  }
}
export class InteractiveExperiment {
  readonly store = new Store(":memory:");
  readonly id: string;
  readonly startedAt: number;
  private readonly runStartedAt = Date.now();
  private readonly priorAttempts: unknown[];
  private readonly priorInputCount: number;
  private waitingForFreshInput: boolean;
  endedAt: number | null = null;
  microphoneCalls = 0;
  readonly inputs: ExperimentSession["inputs"] = [];
  readonly calls: ExperimentTrace["calls"] = [];
  readonly diagnostics: unknown[] = [];
  readonly messages: ExperimentSession["messages"] = [];
  readonly coordinator: ReactionEngine<Buffer, NodeJS.Timeout>;
  readonly implementation: ReactionPipeline;
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private dirty = true;
  private savedState = "";
  readonly abort = new AbortController();
  constructor(
    readonly options: ExperimentStart,
    readonly pipeline: LoadedPipeline,
    readonly adapter: { model: Model<Buffer>; name: string },
    private readonly save: (trace: ExperimentTrace) => void,
    random: () => number = Math.random,
    restored?: ExperimentTrace,
  ) {
    this.id = restored?.session.id ?? randomUUID();
    this.startedAt = restored?.session.startedAt ?? this.runStartedAt;
    this.priorAttempts = structuredClone(restored?.attempts ?? []);
    this.priorInputCount = restored?.session.inputs.length ?? 0;
    this.waitingForFreshInput = !!restored;
    if (restored) {
      this.inputs.push(...structuredClone(restored.session.inputs));
      this.messages.push(...structuredClone(restored.session.messages));
      this.calls.push(...structuredClone(restored.calls));
      for (const call of this.calls)
        if (!call.result && !call.error) call.error = "canceled";
      this.diagnostics.push(...structuredClone(restored.diagnostics));
      this.microphoneCalls = restored.session.microphoneCalls;
    }
    const config = applyPipelineProfile(
      configSchema.parse({
        ai: {
          provider:
            options.provider === "chatgpt_subscription"
              ? "chatgpt_subscription"
              : "openai_api",
          description: options.topic,
          visualMode: "on_request",
        },
      }),
      pipeline,
    );
    // This surface has speech/text only. Preserve the profile's pacing and review.
    config.ai.visualMode = "on_request";
    config.ai.pipelineType = options.pipelineType ?? config.ai.pipelineType;
    this.implementation = reactionPipelines.get(config.ai.pipelineType);
    const screen = { recent: () => [], has: () => false };
    const cast = createBroadcastCast(this.store, () => options.topic, {
      cards: pipelineCards(pipeline),
    });
    try {
      if (restored) restoreExperiment(this.store, restored);
      else cast.prepare();
    } catch (error) {
      this.store.close();
      throw error;
    }
    this.store.on("event", (event) => {
      if (event?.type === "message.added") {
        const message = this.store.publicMessage(event.payload.id);
        if (message) {
          this.messages.push(message);
          this.dirty = true;
        }
      }
    });
    const model: Model<Buffer> = async (input, signal) => {
      const call: ExperimentTrace["calls"][number] = {
        id: randomUUID(),
        memberId: this.store
          .personaRuntime()
          ?.members.find((member) => member.displayName === input.persona.name)
          ?.id,
        personaName: input.persona.name,
        stage: input.reviewDraft ? "review" : "generation",
        provider: options.provider,
        model: adapter.name,
        at: Date.now(),
        elapsedMs: 0,
        request: structuredClone(
          inspectedModelRequest(input, pipeline.prompts),
        ),
      };
      this.calls.push(call);
      this.dirty = true;
      const start = performance.now();
      try {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
        const result = await adapter.model(input, deadline);
        deadline.throwIfAborted();
        call.result = structuredClone(inspectedModelResult(result));
        return result;
      } catch (error) {
        call.error = signal.aborted ? "canceled" : generationIssue(error).code;
        throw error;
      } finally {
        call.elapsedMs = Math.round(performance.now() - start);
        this.dirty = true;
      }
    };
    this.coordinator = this.implementation.create<Buffer, NodeJS.Timeout>(
      this.store,
      screen,
      config,
      model,
      false,
      () => true,
      {
        recent: () =>
          this.waitingForFreshInput ? [] : this.store.transcripts.recent(),
        has: (id) => this.store.transcripts.recent().some((t) => t.id === id),
      },
      new TimingGate(config.ai.gate, {
        ensureReady() {},
        async evaluate() {
          throw Error("Timing disabled");
        },
      }),
      random,
      {
        now: Date.now,
        id: randomUUID,
        hash: (value) => createHash("sha256").update(value).digest("hex"),
        clock: {
          repeat: (cb, ms) => setInterval(cb, ms),
          cancelRepeat: clearInterval,
          delay: (cb, ms) => setTimeout(cb, ms),
          cancelDelay: clearTimeout,
        },
        issue: (error) => ({ issue: generationIssue(error), details: {} }),
      },
    );
    this.coordinator.onDiagnostic = (entry) => {
      this.diagnostics.push(entry);
      this.dirty = true;
      if (this.diagnostics.length > 2000) this.diagnostics.shift();
    };
  }
  start() {
    this.persist();
    this.coordinator.start();
    this.timer = setInterval(() => {
      try {
        if (Date.now() - this.runStartedAt >= 30 * 60_000)
          this.stop("time_limit");
        else if (
          this.dirty ||
          this.savedState !==
            this.coordinator.state + ":" + this.coordinator.phase
        )
          this.persist();
      } catch {
        this.coordinator.stop("storage_error");
        this.abort.abort();
        clearInterval(this.timer);
      }
    }, 1000);
    this.timer.unref();
  }
  assertOpen() {
    if (this.endedAt || this.coordinator.state !== "running")
      throw new ExperimentError(
        "진행 중인 테스트가 아닙니다. 새 테스트를 시작해 주세요.",
      );
    if (this.inputs.length - this.priorInputCount >= 300)
      throw new ExperimentError(
        "입력 300개 한도입니다. 테스트를 종료해 주세요.",
      );
  }
  input(
    id: string,
    text: string,
    source: "text" | "microphone",
    at = Date.now(),
  ) {
    this.assertOpen();
    if (this.inputs.some((input) => input.id === id)) return;
    if (!this.store.transcripts.record({ id, capturedAt: at, text }))
      throw new ExperimentError("입력을 저장하지 못했습니다.");
    this.inputs.push({ id, text, source, at });
    this.waitingForFreshInput = false;
    this.persist();
    // The shared host and AI service apply production selection, pacing and review.
    if (source === "text") void this.coordinator.tick();
  }
  async refreshInspection() {
    try {
      await this.implementation.refreshInspection?.(this.coordinator);
      if (!this.disposed) this.persist();
    } catch {
      /* Viewing state cannot stop a test. */
    }
  }
  private viewerStates(): ExperimentSession["viewerStates"] {
    try {
      return viewerInspectionSchema
        .array()
        .parse(this.implementation.inspect?.(this.coordinator) ?? []);
    } catch {
      return [];
    } // Inspection failures cannot stop recording or generation.
  }
  snapshot(): ExperimentSession {
    return {
      id: this.id,
      topic: this.options.topic,
      provider: this.options.provider,
      model: this.adapter.name,
      pipelineType: this.implementation.id,
      pipelineRevision: this.implementation.revision,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      state: this.coordinator.state,
      phase: this.coordinator.phase,
      issue: this.coordinator.lastIssue?.message ?? null,
      profile: {
        id: this.pipeline.profile.id,
        revision: this.pipeline.profile.revision,
        digest: this.pipeline.digest,
      },
      calls: this.store.usage().calls,
      microphoneCalls: this.microphoneCalls,
      inputs: [...this.inputs],
      messages: [...this.messages],
      personas: this.store.personaRuntime()?.members ?? [],
      viewerStates: this.viewerStates(),
    };
  }
  trace(): ExperimentTrace {
    return {
      memories: this.store.viewerMemory.list(),
      session: this.snapshot(),
      pipeline: { ...this.pipeline, effectiveAi: this.coordinator.config.ai },
      calls: this.calls,
      diagnostics: this.diagnostics,
      personaProvenance: this.store.db
        .prepare(
          "SELECT persona_id,provenance FROM persona_versions ORDER BY rowid",
        )
        .all()
        .map((row) => ({
          personaId: String(row.persona_id),
          provenance: JSON.parse(String(row.provenance)),
        })),
      attempts: [
        ...this.priorAttempts,
        ...this.store.db
          .prepare(
            "SELECT state,reason,result,model_manifest FROM persona_reaction_attempts ORDER BY rowid",
          )
          .all(),
      ],
    };
  }
  persist() {
    if (this.disposed) return;
    try {
      this.save(this.trace());
      this.dirty = false;
      this.savedState = this.coordinator.state + ":" + this.coordinator.phase;
    } catch {
      this.coordinator.stop("storage_error");
      this.abort.abort();
      clearInterval(this.timer);
      throw new ExperimentError(
        "테스트 기록을 저장하지 못해 중지했습니다. 저장 공간을 확인해 주세요.",
        500,
      );
    }
  }
  stop(reason = "stopped") {
    if (this.endedAt) return;
    clearInterval(this.timer);
    this.endedAt = Date.now();
    this.abort.abort();
    this.coordinator.stop(reason);
    for (const call of this.calls)
      if (!call.result && !call.error) call.error = "canceled";
    this.persist();
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.stop();
    } finally {
      this.disposed = true;
      this.store.close();
    }
  }
}

/** Private artifacts have their own lifecycle, independent of broadcast storage. */
export class ExperimentWorkspace {
  active?: InteractiveExperiment;
  constructor(
    readonly directory: string,
    private readonly pipeline: LoadedPipeline,
    private readonly model: (
      provider: ExperimentStart["provider"],
      pipeline: LoadedPipeline,
    ) => {
      model: Model<Buffer>;
      name: string;
    },
    private readonly random?: () => number,
    readonly defaultPipelineType = pipeline.profile.ai.pipelineType ??
      "standard",
  ) {}
  private path(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new ExperimentError("테스트를 찾을 수 없습니다.", 404);
    return join(this.directory, id + ".json");
  }
  private save = (trace: ExperimentTrace) => {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(trace.session.id);
    writeFileSync(path + ".tmp", JSON.stringify(trace), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  };
  list() {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
      .map((name) => {
        const trace = this.read(name.slice(0, -5));
        const { id, topic, provider, startedAt, endedAt, state } =
          trace.session;
        return { id, topic, provider, startedAt, endedAt, state };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }
  start(options: ExperimentStart) {
    try {
      reactionPipelines.get(options.pipelineType ?? this.defaultPipelineType);
    } catch {
      throw new ExperimentError(
        "등록되지 않은 AI 유형입니다. 테스트 서버의 구현 목록을 확인해 주세요.",
        400,
      );
    }
    if (this.active && !this.active.endedAt)
      throw new ExperimentError("진행 중인 테스트를 먼저 종료해 주세요.");
    if (this.list().length >= 100)
      throw new ExperimentError(
        "저장된 테스트 100개 한도입니다. 이전 테스트를 삭제해 주세요.",
      );
    const adapter = this.resolveModel(options.provider);
    this.active?.dispose();
    this.active = undefined;
    const session = new InteractiveExperiment(
      {
        ...options,
        pipelineType: options.pipelineType ?? this.defaultPipelineType,
      },
      this.pipeline,
      adapter,
      this.save,
      this.random,
    );
    try {
      session.start();
    } catch (error) {
      session.dispose();
      throw error;
    }
    this.active = session;
    return session.snapshot();
  }
  private resolveModel(
    provider: ExperimentStart["provider"],
    pipeline = this.pipeline,
  ) {
    try {
      return this.model(provider, pipeline);
    } catch {
      throw new ExperimentError(
        provider === "chatgpt_subscription"
          ? "테스트용 AI 연결에서 Sign in with ChatGPT 계정과 모델을 선택해 주세요."
          : provider === "openai_api"
            ? "Responses API가 선택되어 있습니다. 테스트 서버의 OPENAI_API_KEY와 OPENAI_MODEL을 설정하거나 AI 연결을 Sign in with ChatGPT로 변경해 주세요."
            : "모의 응답을 준비하지 못했습니다. 다시 시도해 주세요.",
      );
    }
  }
  resume(id: string, _legacyAdditionalCalls?: number) {
    if (this.active && !this.active.endedAt)
      throw new ExperimentError("진행 중인 테스트를 먼저 종료해 주세요.");
    const trace = structuredClone(this.read(id));
    const pipeline = z
      .object({
        profile: pipelineProfileSchema,
        prompts: z.object({
          answer: z.string().min(1),
          review: z.string().min(1),
        }),
        digest: z.string(),
      })
      .parse(trace.pipeline);
    let implementation: ReactionPipeline;
    try {
      implementation = reactionPipelines.get(trace.session.pipelineType);
    } catch {
      throw new ExperimentError(
        "저장된 AI 유형이 등록되어 있지 않습니다. 구현을 복원한 뒤 다시 시도해 주세요.",
      );
    }
    if (implementation.revision !== trace.session.pipelineRevision)
      throw new ExperimentError(
        "AI 구현 버전이 변경되었습니다. 새 테스트를 시작해 주세요.",
      );
    const provider = z
      .enum(["fixture", "openai_api", "chatgpt_subscription"])
      .parse(trace.session.provider);
    const adapter = this.resolveModel(provider, pipeline);
    this.active?.dispose();
    this.active = undefined;
    const session = new InteractiveExperiment(
      {
        topic: trace.session.topic,
        provider,
        pipelineType: trace.session.pipelineType,
      },
      pipeline,
      adapter,
      this.save,
      this.random,
      trace,
    );
    session.diagnostics.push({
      event: "resumed",
      at: Date.now(),
      previousEndedAt: trace.session.endedAt,
      previousModel: trace.session.model,
      model: adapter.name,
    });
    try {
      session.start();
    } catch (error) {
      try {
        session.dispose();
      } finally {
        this.save(trace);
      }
      throw error;
    }
    this.active = session;
    return session.snapshot();
  }
  read(id: string): ExperimentTrace {
    if (this.active?.id === id) return this.active.trace();
    if (!existsSync(this.path(id)))
      throw new ExperimentError("테스트를 찾을 수 없습니다.", 404);
    const trace = experimentTraceSchema.parse(
      JSON.parse(readFileSync(this.path(id), "utf8")),
    );
    if (!trace.session.endedAt) {
      trace.session.state = "interrupted";
      trace.session.phase = "interrupted";
      trace.session.endedAt = trace.session.startedAt;
    }
    return trace;
  }
  current(id: string) {
    if (!this.active || this.active.id !== id)
      throw new ExperimentError("진행 중인 테스트를 찾을 수 없습니다.");
    return this.active;
  }
  delete(id: string) {
    if (this.active?.id === id) {
      this.active.dispose();
      this.active = undefined;
    }
    if (existsSync(this.path(id))) unlinkSync(this.path(id));
  }
  close() {
    this.active?.dispose();
  }
}
