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
import { ReactionCoordinator } from "../../application/reactions/coordinator.ts";
import { TimingGate } from "../../application/reactions/timing-gate.ts";
import type { Model } from "../../application/reactions/model-port.ts";
import { createBroadcastCast } from "../cast/runtime.ts";
import {
  applyPipelineProfile,
  pipelineCards,
  type LoadedPipeline,
} from "../reactions/pipeline-profile.ts";
import { modelMessages } from "../reactions/model-messages.ts";
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
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  endedAt: number | null = null;
  microphoneCalls = 0;
  readonly inputs: ExperimentSession["inputs"] = [];
  readonly calls: ExperimentTrace["calls"] = [];
  readonly diagnostics: unknown[] = [];
  readonly messages: ExperimentSession["messages"] = [];
  readonly coordinator: ReactionCoordinator<Buffer, NodeJS.Timeout>;
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
  ) {
    const config = applyPipelineProfile(
      configSchema.parse({
        ai: {
          provider:
            options.provider === "chatgpt_subscription"
              ? "chatgpt_subscription"
              : "openai_api",
          description: options.topic,
          maxCalls: options.maxCalls,
          visualMode: "on_request",
        },
      }),
      pipeline,
    );
    // This surface has speech/text only. Preserve the profile's pacing and review.
    config.ai.visualMode = "on_request";
    const screen = { recent: () => [], has: () => false };
    const cast = createBroadcastCast(this.store, () => options.topic, {
      cards: pipelineCards(pipeline),
    });
    cast.prepare();
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
        at: Date.now(),
        elapsedMs: 0,
        request: structuredClone(modelMessages(input, pipeline.prompts)),
      };
      this.calls.push(call);
      this.dirty = true;
      const start = performance.now();
      try {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
        const result = await adapter.model(input, deadline);
        deadline.throwIfAborted();
        call.result = structuredClone(result);
        return result;
      } catch (error) {
        call.error = signal.aborted ? "canceled" : generationIssue(error).code;
        throw error;
      } finally {
        call.elapsedMs = Math.round(performance.now() - start);
        this.dirty = true;
      }
    };
    this.coordinator = new ReactionCoordinator<Buffer, NodeJS.Timeout>(
      this.store,
      screen,
      config,
      model,
      false,
      () => true,
      {
        recent: () => this.store.transcripts.recent(),
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
        if (Date.now() - this.startedAt >= 30 * 60_000) this.stop("time_limit");
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
    if (this.inputs.length >= 300)
      throw new ExperimentError(
        "입력 300개 한도입니다. 테스트를 종료해 주세요.",
      );
  }
  input(id: string, text: string, source: "text" | "microphone") {
    this.assertOpen();
    if (this.inputs.some((input) => input.id === id)) return;
    const at = Date.now();
    if (!this.store.transcripts.record({ id, capturedAt: at, text }))
      throw new ExperimentError("입력을 저장하지 못했습니다.");
    this.inputs.push({ id, text, source, at });
    this.persist();
    // The production coordinator owns selection, silence, pacing and review.
    void this.coordinator.tick();
  }
  snapshot(): ExperimentSession {
    return {
      id: this.id,
      topic: this.options.topic,
      provider: this.options.provider,
      model: this.adapter.name,
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
      maxCalls: this.options.maxCalls,
      calls: this.store.usage().calls,
      microphoneCalls: this.microphoneCalls,
      inputs: [...this.inputs],
      messages: [...this.messages],
      personas: this.store.personaRuntime()?.members ?? [],
    };
  }
  trace(): ExperimentTrace {
    return {
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
      attempts: this.store.db
        .prepare(
          "SELECT state,reason,result,model_manifest FROM persona_reaction_attempts ORDER BY rowid",
        )
        .all(),
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
    private readonly model: (provider: ExperimentStart["provider"]) => {
      model: Model<Buffer>;
      name: string;
    },
    private readonly random?: () => number,
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
    if (this.active && !this.active.endedAt)
      throw new ExperimentError("진행 중인 테스트를 먼저 종료해 주세요.");
    if (this.list().length >= 100)
      throw new ExperimentError(
        "저장된 테스트 100개 한도입니다. 이전 테스트를 삭제해 주세요.",
      );
    let adapter: { model: Model<Buffer>; name: string };
    try {
      adapter = this.model(options.provider);
    } catch {
      throw new ExperimentError(
        "AI 연결을 확인해 주세요. Responses API는 OPENAI_API_KEY와 OPENAI_MODEL, Sign in with ChatGPT는 연결된 계정과 모델이 필요합니다.",
      );
    }
    this.active?.dispose();
    const session = new InteractiveExperiment(
      options,
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
