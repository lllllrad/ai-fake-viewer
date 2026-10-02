import type { Store } from "./storage.ts";
import type { Capture } from "./capture.ts";
import type { Transcriber } from "./transcription.ts";
import type { Config } from "./config.ts";
import { validateDecision, type Model, type ModelInput } from "./model.ts";
import type { Decision } from "./contracts.ts";
export class Scheduler {
  state = "stopped";
  controller?: AbortController;
  timer?: NodeJS.Timeout;
  generation = 0;
  busy = false;
  lastAttempt = 0;
  lastSpoke = 0;
  lastHash = "";
  lastExternal = 0;
  personaTimes: number[] = [];
  speechTimes: number[] = [];
  skips = 0;
  rejects = 0;
  pending?: {
    decision: Decision;
    input: ModelInput;
    persona: number;
    expires: number;
    generation: number;
  };
  constructor(
    public store: Store,
    public capture: Capture,
    public config: Config,
    public model: Model,
    public demo = false,
    public providerReady: () => boolean = () =>
      !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL,
    public transcriber?: Transcriber,
  ) {}
  start() {
    if (this.store.closed()) throw Error("Session is closed");
    if (
      this.config.ai.visualMode === "continuous" &&
      (!this.capture.confirmed || !this.capture.recent().length)
    )
      throw Error("Review and confirm fresh masked Program preview first");
    if (
      !this.demo &&
      (!this.config.policy.providerReviewed || !this.providerReady())
    )
      throw Error("Provider review and model connection required");
    this.stop();
    this.state = "running";
    this.timer = setInterval(() => void this.tick(), 1000);
    void this.tick();
  }
  stop(state = "stopped") {
    this.generation++;
    this.controller?.abort();
    clearInterval(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.state = state;
    this.store.audit(`ai.${state}`);
  }
  allowed() {
    return [
      "experiment",
      ...(["youtube", "chzzk", "soop"] as const).filter(
        (p) => this.config.policy[`${p}AiContextApproved`],
      ),
    ];
  }
  async tick(now = Date.now()) {
    if (this.state !== "running") return;
    if (
      this.config.ai.visualMode === "continuous" &&
      (!this.capture.confirmed || !this.capture.recent().length)
    ) {
      this.stop("paused_input_stale");
      return;
    }
    if (this.pending) {
      if (this.pending.expires < now) this.pending = undefined;
      else return;
    }
    if (
      this.busy ||
      now - this.lastAttempt < 20000 ||
      now - this.lastSpoke < 20000
    )
      return;
    const messages = this.store.context(this.allowed());
    const external = this.store
      .snapshot()
      .messages.filter((m) => m && m.attribution !== "experiment") as any[];
    const externalSeq = external.at(-1)?.seq ?? 0;
    const freshExternal = external.filter(
      (m) => m.displayTime > now - 60000,
    ).length;
    if (
      freshExternal > 15 ||
      this.speechTimes.filter((t) => t > now - 60000).length >= 3
    )
      return;
    const transcripts = this.transcriber?.recent() ?? [];
    const allowedExternal = external.filter(
      (m) =>
        m.displayTime > now - 60000 && this.allowed().includes(m.attribution),
    );
    const triggerMessage = allowedExternal.at(-1)?.id ?? "";
    const frames =
      this.config.ai.visualMode === "continuous" ? this.capture.recent() : [];
    const hash =
      this.config.ai.visualMode === "continuous"
        ? frames.at(-1)!.hash
        : `${transcripts.at(-1)?.id ?? ""}:${triggerMessage}`;
    if (
      this.config.ai.visualMode === "on_request" &&
      !transcripts.length &&
      !triggerMessage
    )
      return;
    if (
      hash === this.lastHash &&
      (this.config.ai.visualMode === "on_request" ||
        externalSeq === this.lastExternal)
    )
      return;
    const persona = this.config.ai.personas.findIndex(
      (_, i) => now - (this.personaTimes[i] ?? 0) >= 45000,
    );
    if (persona < 0) return;
    const c = this.config.ai;
    let input: ModelInput = {
      frames,
      transcripts,
      messages,
      persona: c.personas[persona],
      description: c.description,
    };
    const generation = this.generation;
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(30000),
    ]);
    this.busy = true;
    this.lastAttempt = now;
    this.lastHash = hash;
    this.lastExternal = externalSeq;
    try {
      let r = await this.callModel(input, signal);
      if (
        generation !== this.generation ||
        signal.aborted ||
        this.state !== "running"
      )
        return;
      let d = validateDecision(r.decision, input);
      if (d.action === "inspect") {
        if (
          c.visualMode !== "on_request" ||
          !this.capture.confirmed ||
          !this.capture.recent().length
        ) {
          this.skips++;
          return;
        }
        input = { ...input, frames: this.capture.recent() };
        r = await this.callModel(input, signal);
        if (
          generation !== this.generation ||
          signal.aborted ||
          this.state !== "running"
        )
          return;
        d = validateDecision(r.decision, input);
      }
      if (d.action === "inspect") {
        this.skips++;
        return;
      }
      if (d.action === "skip") {
        this.skips++;
        return;
      }
      if (
        this.store.closed() ||
        (input.frames.length > 0 &&
          (!this.capture.confirmed || !this.capture.recent().length)) ||
        d.evidenceTranscriptIds.some((id) => !this.transcriber?.has(id)) ||
        d.evidenceMessageIds.some((id) => !this.store.publicMessage(id)) ||
        (d.replyToMessageId && !this.store.publicMessage(d.replyToMessageId))
      )
        return;
      this.pending = {
        decision: d,
        input,
        persona,
        expires: Math.min(
          Date.now() + 30000,
          input.frames.length
            ? input.frames.at(-1)!.capturedAt + 30000
            : Date.now() + 30000,
        ),
        generation,
      };
      if (!c.manualApproval) this.approve();
    } catch (error) {
      if (generation === this.generation) {
        this.rejects++;
        this.stop(
          error instanceof Error && error.message === "budget_exhausted"
            ? "budget_exhausted"
            : "model_error",
        );
      }
    } finally {
      this.busy = false;
    }
  }
  async callModel(input: ModelInput, signal: AbortSignal) {
    const c = this.config.ai;
    const priced =
      c.provider === "openai_api" &&
      c.inputUsdPerMillion !== null &&
      c.outputUsdPerMillion !== null &&
      !!c.priceCheckedAt;
    const reserve = priced
      ? (c.maxInputTokens * c.inputUsdPerMillion! +
          c.maxOutputTokens * c.outputUsdPerMillion!) /
        1e6
      : null;
    const usageId = this.store.reserve(c.maxCalls, c.maxUsd, reserve);
    if (!usageId) throw Error("budget_exhausted");
    const result = await this.model(input, signal);
    let cost: number | null = null;
    if (
      priced &&
      Number.isFinite(result.inputTokens) &&
      Number.isFinite(result.outputTokens)
    )
      cost =
        (result.inputTokens! * c.inputUsdPerMillion! +
          result.outputTokens! * c.outputUsdPerMillion!) /
        1e6;
    this.store.settle(usageId, result.inputTokens, result.outputTokens, cost);
    return result;
  }
  approve() {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    if (
      p.generation !== this.generation ||
      p.expires < Date.now() ||
      this.state !== "running" ||
      this.store.closed() ||
      (p.input.frames.length > 0 &&
        (!this.capture.confirmed || !this.capture.recent().length)) ||
      p.decision.evidenceTranscriptIds.some((id) => !this.transcriber?.has(id))
    )
      return;
    const d = p.decision;
    if (
      d.evidenceMessageIds.some((id) => !this.store.publicMessage(id)) ||
      (d.replyToMessageId && !this.store.publicMessage(d.replyToMessageId))
    )
      return;
    const now = Date.now();
    this.store.ingestBatch([
      {
        platform: "experiment",
        channel: this.store.sessionId,
        author: `persona-${p.persona}`,
        name: this.config.ai.personas[p.persona].name,
        text: d.text!,
        replyToId: d.replyToMessageId,
      },
    ]);
    this.lastSpoke = now;
    this.personaTimes[p.persona] = now;
    this.speechTimes = this.speechTimes.filter((t) => t > now - 60000);
    this.speechTimes.push(now);
  }
  reject() {
    this.pending = undefined;
    this.rejects++;
  }
}
