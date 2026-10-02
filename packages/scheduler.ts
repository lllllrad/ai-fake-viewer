import type { Store } from "./storage.ts";
import type { Capture } from "./capture.ts";
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
  ) {}
  start() {
    if (this.store.closed()) throw Error("Session is closed");
    if (!this.capture.confirmed || !this.capture.recent().length)
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
    if (!this.capture.confirmed || !this.capture.recent().length) {
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
    const frames = this.capture.recent();
    const hash = frames.at(-1)!.hash;
    if (hash === this.lastHash && externalSeq === this.lastExternal) return;
    const persona = this.config.ai.personas.findIndex(
      (_, i) => now - (this.personaTimes[i] ?? 0) >= 45000,
    );
    if (persona < 0) return;
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
    if (!usageId) {
      this.stop("budget_exhausted");
      return;
    }
    const input: ModelInput = {
      frames,
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
      const r = await this.model(input, signal);
      let cost: number | null = null;
      if (
        priced &&
        Number.isFinite(r.inputTokens) &&
        Number.isFinite(r.outputTokens)
      )
        cost =
          (r.inputTokens! * c.inputUsdPerMillion! +
            r.outputTokens! * c.outputUsdPerMillion!) /
          1e6;
      this.store.settle(usageId, r.inputTokens, r.outputTokens, cost);
      if (
        generation !== this.generation ||
        signal.aborted ||
        this.state !== "running"
      )
        return;
      const d = validateDecision(r.decision, input);
      if (d.action === "skip") {
        this.skips++;
        return;
      }
      if (
        this.store.closed() ||
        !this.capture.confirmed ||
        !this.capture.recent().length ||
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
          input.frames.at(-1)!.capturedAt + 30000,
        ),
        generation,
      };
      if (!c.manualApproval) this.approve();
    } catch {
      if (generation === this.generation) {
        this.rejects++;
        this.stop("model_error");
      }
    } finally {
      this.busy = false;
    }
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
      !this.capture.confirmed ||
      !this.capture.recent().length
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
