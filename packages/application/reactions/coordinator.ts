import { personaStyle as serializePersona } from "./persona-style.ts";
import type {
  ReactionStore,
  ReactionScreen,
  ReactionSpeech,
  ReactionConfig,
  ReactionRuntime,
} from "./coordinator-ports.ts";
import { GenerationRecovery } from "./recovery.ts";
import { GenerationWork } from "./generation-work.ts";
import { ReactionSchedule } from "./scheduling.ts";
import { createReactionProgram, type ReactionProgram } from "./program.ts";
import { callMeteredModel } from "./model-call.ts";
import {
  selectEvidenceWindow,
  baselinePacingBlocked,
  messageVersion,
} from "../../domain/reactions/evidence.ts";
import { castPacingBlocked } from "../../domain/reactions/cast-selection.ts";
import type { Model, ModelInput } from "./model-port.ts";
import {
  evidenceProblem,
  publicationProblem,
  type CurrentEvidence,
} from "../../domain/reactions/publication.ts";
import { TimingGate } from "./timing-gate.ts";
import { type Decision } from "../../contracts/decision.ts";
export class AiStartError extends Error {
  statusCode = 409;
}
export class ReactionCoordinator<
  Bytes extends Uint8Array = Uint8Array,
  Handle = unknown,
> {
  diagnostics: Array<{
    at: number;
    event: string;
    phase: string;
    details: Record<string, string | number>;
  }> = [];
  onDiagnostic?: (
    entry: ReactionCoordinator<Bytes, Handle>["diagnostics"][number],
  ) => void;
  private trace(
    event: string,
    details: Record<string, string | number> = {},
    memberId?: string,
  ) {
    const entry = {
      at: this.runtime.now(),
      event,
      phase: this.phase,
      details: { ...details, ...(memberId ? { memberId } : {}) },
    };
    this.diagnostics.push(entry);
    this.diagnostics = this.diagnostics.slice(-100);
    try {
      this.onDiagnostic?.(entry);
    } catch {
      /* Diagnostics cannot stop generation. */
    }
  }
  readyCheck?: () => string[];
  preparePersonas?: () => void;
  private selecting?: AbortController;
  private readonly work = new GenerationWork<ModelInput<Bytes>>((input) =>
    this.discardInput(input),
  );
  private discardInput(input: ModelInput<Bytes>) {
    input.messages = [];
    input.newMessages = [];
    input.chatSummary = undefined;
    input.reviewDraft = undefined;
  }
  state = "stopped";
  private readonly recovery = new GenerationRecovery();
  get lastIssue() {
    return this.recovery.lastIssue;
  }
  get controller() {
    return this.work.controller;
  }
  private readonly scheduling: ReactionSchedule<Handle>;
  get timer() {
    return this.scheduling.pollHandle;
  }
  get dispatchTimer() {
    return this.scheduling.dispatchHandle;
  }
  get generation() {
    return this.work.generation;
  }
  get busy() {
    return !!this.selecting || this.work.busy;
  }
  lastAttempt = 0;
  lastSpoke = 0;
  lastHash = "";
  lastExternal = 0;
  processedTranscriptIds = new Set<string>();
  processedMessageVersions = new Map<string, string>();
  reviews = 0;
  phase = "stopped";
  lastInput = {
    newTranscripts: 0,
    contextTranscripts: 0,
    newMessages: 0,
    contextMessages: 0,
    frames: 0,
  };
  personaTimes: number[] = [];
  speechTimes: number[] = [];
  skips = 0;
  rejects = 0;
  pending?: {
    decision: Decision;
    input: ModelInput<Bytes>;
    persona: number;
    expires: number;
    sessionId: string;
    generation: number;
    personaSessionId?: string;
    memberId?: string;
    sessionEpoch?: number;
    memberEpoch?: number;
    definitionHash?: string;
    attemptId?: string;
    notBefore?: number;
  };
  constructor(
    public store: ReactionStore,
    public capture: ReactionScreen<Bytes>,
    public config: ReactionConfig,
    public model: Model<Bytes>,
    public demo: boolean,
    public providerReady: () => boolean,
    public transcriber: ReactionSpeech | undefined,
    public gate: TimingGate,
    public random: () => number,
    private readonly runtime: ReactionRuntime<Handle>,
    readonly program: ReactionProgram = createReactionProgram(
      config.ai.pipelineType ?? "standard",
    ),
  ) {
    this.scheduling = new ReactionSchedule(runtime.clock, () =>
      this.schedulerFailed(),
    );
    store.on("context_invalidated", () => this.invalidateChatContext());
    store.on("reset", () => this.invalidateChatContext());
  }
  invalidateChatContext() {
    this.selecting?.abort();
    this.selecting = undefined;
    this.work.cancel();
    this.scheduling.cancelDispatch();
    if (this.pending) this.discardInput(this.pending.input);
    this.pending = undefined;
    this.store.cancelChatContextAttempts();
    this.processedMessageVersions.clear();
    if (this.state === "running") this.phase = "waiting_for_input";
  }
  start() {
    if (this.store.closed())
      throw new AiStartError("Session is closed. Start a new session first.");
    const missing = this.readyCheck?.() ?? [];
    if (missing.length)
      throw new AiStartError(
        "AI 시작에 필요한 필수 입력을 확인해 주세요: " +
          missing.join(", ") +
          ".",
      );
    if (
      this.config.ai.visualMode === "continuous" &&
      !this.capture.recent().length
    )
      throw new AiStartError(
        "Wait for a fresh video frame before starting continuous video AI.",
      );
    if (!this.demo && !this.providerReady())
      throw new AiStartError(
        this.config.ai.provider === "chatgpt_subscription"
          ? "Connect ChatGPT and select a model in admin before starting AI."
          : "Set OPENAI_API_KEY and OPENAI_MODEL in .env, then restart before starting AI.",
      );
    this.preparePersonas?.();
    this.stop();
    this.recovery.success();
    this.state = "running";
    this.phase = "waiting_for_input";
    this.store.setAiDesiredRunning(true);
    this.scheduling.start(() => void this.tick(), 1000);
    void this.tick();
  }
  stop(state = "stopped", preserveDesired = false) {
    this.selecting?.abort();
    this.selecting = undefined;
    this.work.cancel();
    if (this.pending) this.discardInput(this.pending.input);
    this.scheduling.stop();
    this.pending = undefined;
    this.lastAttempt = 0;
    this.state = state;
    this.phase = state;
    if (!preserveDesired) this.store.setAiDesiredRunning(false);
    try {
      this.store.audit(`ai.${state}`);
    } catch {
      /* local gate already closed */
    }
  }
  allowed() {
    return ["experiment", "youtube", "chzzk", "soop"];
  }
  async tick(now = this.runtime.now()) {
    const generation = this.generation;
    try {
      await this.tickOnce(now);
    } catch {
      if (generation === this.generation) this.schedulerFailed();
    }
  }
  private schedulerFailed() {
    this.rejects++;
    this.recovery.schedulerFailed(this.runtime.now());
    try {
      this.stop("scheduler_error");
    } catch {
      /* The timer and local gate are already stopped. */
    }
  }
  private async tickOnce(now: number) {
    if (this.state !== "running") return;
    if (
      this.config.ai.visualMode === "continuous" &&
      !this.capture.recent().length
    ) {
      this.stop("paused_input_stale");
      return;
    }
    if (this.pending) {
      if (this.pending.expires <= now) {
        if (this.pending.attemptId)
          this.store.attempts.finish(
            this.pending.attemptId,
            "expired",
            "candidate_expired",
          );
        this.pending = undefined;
      } else return;
    }
    if (this.busy || now < this.lastAttempt) {
      if (!this.busy) this.phase = "random_wait";
      return;
    }
    const evidence = selectEvidenceWindow({
      now,
      windowMs: this.config.ai.contextWindowSeconds * 1000,
      transcriptLimit: this.config.ai.transcriptLimit,
      recent: this.store.snapshot().messages,
      messages: this.store.context(this.allowed()),
      transcripts: this.transcriber?.recent() ?? [],
      allowedPlatforms: this.allowed(),
      processedTranscriptIds: this.processedTranscriptIds,
      processedMessageVersions: this.processedMessageVersions,
    });
    const recent = evidence.recent,
      externalSeq = evidence.externalSequence;
    let { messages, transcripts, newMessages, newTranscripts } = evidence;
    this.processedTranscriptIds = evidence.processedTranscriptIds;
    this.processedMessageVersions = evidence.processedMessageVersions;
    if (
      baselinePacingBlocked(evidence.recentExternalCount, this.speechTimes, now)
    )
      return;
    const triggerMessage = evidence.triggerMessage?.id ?? "";
    let frames =
      this.config.ai.visualMode === "continuous"
        ? this.capture.recent().slice(-1)
        : [];
    const hash =
      this.config.ai.visualMode === "continuous"
        ? frames.at(-1)!.hash
        : this.runtime.hash(
            JSON.stringify({
              transcripts: newTranscripts.map((transcript) => transcript.id),
              messages: evidence.newExternalMessages.map((message) => ({
                id: message.id,
                version: messageVersion(message),
              })),
            }),
          );
    if (
      this.config.ai.visualMode === "on_request" &&
      !newTranscripts.length &&
      !triggerMessage
    ) {
      this.phase = "waiting_for_input";
      return;
    }
    if (
      hash === this.lastHash &&
      (this.config.ai.visualMode === "on_request" ||
        externalSeq === this.lastExternal)
    )
      return;
    let personaRuntime: ReturnType<ReactionStore["personaRuntime"]>;
    try {
      personaRuntime = this.store.personaRuntime();
    } catch {
      this.stop("persona_control_unavailable");
      return;
    }
    if (personaRuntime && !personaRuntime.armed) return;
    if (
      personaRuntime &&
      castPacingBlocked({
        recent,
        speechTimes: this.speechTimes,
        now,
        lastSpoke: this.lastSpoke,
        policy: personaRuntime.policy,
      })
    )
      return;
    let persona = -1;
    let activeMember:
      | NonNullable<
          ReturnType<ReactionStore["personaRuntime"]>
        >["members"][number]
      | undefined;
    if (personaRuntime) {
      const selection = new AbortController();
      const selectionGeneration = this.generation;
      this.selecting = selection;
      let selected;
      try {
        selected = await this.program.select(
          {
            members: personaRuntime.members,
            recent,
            observation: {
              messages,
              transcripts,
              frames,
              newMessages,
              newTranscripts,
            },
            now,
            contextWindowMs: this.config.ai.contextWindowSeconds * 1000,
            minimumPacingMs: this.config.ai.pacing.minSeconds * 1000,
            maximumPacingMs: this.config.ai.pacing.maxSeconds * 1000,
            policy: personaRuntime.policy,
            randomValues: Array.from(
              { length: personaRuntime.members.length + 2 },
              () => this.random(),
            ),
          },
          selection.signal,
        );
      } finally {
        if (this.selecting === selection) this.selecting = undefined;
      }
      if (
        selection.signal.aborted ||
        selectionGeneration !== this.generation ||
        this.state !== "running"
      )
        return;
      if (!selected) {
        this.trace("cast_selection_skipped", {
          reason: "no_eligible_or_willing_member",
        });
        this.lastHash = hash;
        this.lastExternal = externalSeq;
        this.skips++;
        return;
      }
      activeMember = selected.member;
      this.trace(
        "cast_member_selected",
        {
          newMessages: selected.observation.newMessages.length,
          newTranscripts: selected.observation.newTranscripts.length,
        },
        activeMember.id,
      );
      persona = selected.index;
      ({ messages, transcripts, frames, newMessages, newTranscripts } =
        selected.observation);
    } else {
      persona = this.config.ai.personas.findIndex(
        (_, i) =>
          now - (this.personaTimes[i] ?? 0) >=
          this.config.ai.pacing.minSeconds * 1000,
      );
      if (persona < 0) return;
    }
    const c = this.config.ai;
    const personaStyle = activeMember
      ? serializePersona(activeMember.snapshot)
      : c.personas[persona].style;
    const publicDescription = personaRuntime
      ? `${personaRuntime.brief.topic}. ${personaRuntime.brief.audience_intent}. ${personaRuntime.brief.public_context}`
      : c.description;
    let input: ModelInput<Bytes> = {
      privacyRevision: this.store.participation?.revision,
      frames,
      transcripts,
      newTranscripts,
      messages,
      newMessages,
      persona: activeMember
        ? { name: activeMember.displayName, style: personaStyle }
        : c.personas[persona],
      description: publicDescription,
    };
    this.lastInput = {
      newTranscripts: newTranscripts.length,
      contextTranscripts: transcripts.length,
      newMessages: newMessages.length,
      contextMessages: messages.length,
      frames: frames.length,
    };
    const generation = this.generation;
    input.chatSummary = this.store.chatSummary();
    const attemptId =
      activeMember && personaRuntime ? this.runtime.id() : undefined;
    if (attemptId && activeMember && personaRuntime) {
      const created = this.store.attempts.begin({
        id: attemptId,
        sessionId: personaRuntime.id,
        memberId: activeMember.id,
        eventIds: [
          ...new Set([
            ...newMessages.map((x) => x.id),
            ...newTranscripts.map((x) => x.id),
          ]),
        ].slice(0, 3),
        cutoff: this.store.lastSeq(),
        contextKey: this.runtime.hash(
          JSON.stringify({
            cutoff: this.store.lastSeq(),
            messages: messages.map((m) => m.id),
            transcripts: transcripts.map((t) => t.id),
            frames: frames.map((f) => f.id),
          }),
        ),
        sessionEpoch: personaRuntime.controlEpoch,
        memberEpoch: activeMember.epoch,
        definitionHash: activeMember.hash,
        configRevision: personaRuntime.configRevision,
      });
      if (!created) {
        this.lastHash = hash;
        this.phase = "waiting_for_input";
        return;
      }
    }
    const lease = this.work.begin(input);
    const signal = AbortSignal.any([
      lease.signal,
      AbortSignal.timeout(personaRuntime?.policy.model_timeout_ms ?? 30000),
    ]);
    this.lastHash = hash;
    this.lastExternal = externalSeq;
    try {
      const consumeNewInput = () => {
        for (const transcript of newTranscripts)
          this.processedTranscriptIds.add(transcript.id);
        for (const message of newMessages)
          this.processedMessageVersions.set(
            message.id,
            messageVersion(message),
          );
      };
      if (!this.demo && c.gate.enabled) {
        this.phase = "jev_timing_filter";
        consumeNewInput();
        const allowed = await this.gate.allow(input, signal);
        if (
          generation !== this.generation ||
          signal.aborted ||
          this.state !== "running"
        )
          return;
        if (!allowed) {
          this.skips++;
          if (this.gate.state === "budget_exhausted")
            this.stop(`gate_${this.gate.state}`);
          else this.lastAttempt = 0;
          return;
        }
        // Evidence may expire or be hidden while the gate is evaluating.
        if (
          input.transcripts?.some((t) => !this.transcriber?.has(t.id)) ||
          input.messages.some((m) => !this.store.publicMessage(m.id))
        )
          return;
      } else {
        consumeNewInput();
      }
      const outcome = await this.program.draft({
        input,
        signal,
        isCurrent: () => this.work.current(lease) && this.state === "running",
        inspectAllowed: c.visualMode === "on_request",
        review: c.reviewDraft && !this.demo,
        latestFrames: () => this.capture.recent(),
        hasTranscript: (id) => !!this.transcriber?.has(id),
        model: (request, requestSignal) =>
          this.callModel(request, requestSignal),
        active: (request) => {
          this.work.track(lease, request);
        },
        phase: (phase) => {
          this.phase = phase;
          if (phase === "ai_review") this.reviews++;
        },
        trace: (event, details) => this.trace(event, details, activeMember?.id),
      });
      if (
        outcome.kind === "canceled" ||
        generation !== this.generation ||
        signal.aborted ||
        this.state !== "running"
      )
        return;
      this.recovery.success();
      if (outcome.kind === "skipped") {
        if (attemptId)
          this.store.attempts.finish(
            attemptId,
            "skipped",
            outcome.reason,
            outcome.decision,
          );
        this.skips++;
        return;
      }
      input = outcome.input;
      const d = outcome.decision;
      const problem = this.store.closed()
        ? "broadcast_closed"
        : evidenceProblem(input, d, this.currentEvidence(input, d));
      if (problem) {
        this.trace(
          "candidate_discarded",
          { reason: problem },
          activeMember?.id,
        );
        if (attemptId)
          this.store.attempts.finish(attemptId, "canceled", problem);
        return;
      }
      const triggerTimes = [
        ...newMessages
          .map((x) => recent.find((m) => m?.id === x.id)?.displayTime)
          .filter((x): x is number => x !== undefined),
        ...newTranscripts.map((x) => x.capturedAt),
        ...(personaRuntime
          ? frames
              .filter((f) => f.capturedAt >= now - 5000)
              .map((f) => f.capturedAt)
          : []),
      ];
      const triggerAt = triggerTimes.length ? Math.max(...triggerTimes) : now;
      const responseDelay = personaRuntime
        ? Math.floor(
            this.random() *
              ((personaRuntime.policy.response_delay_max_ms ?? 2500) -
                (personaRuntime.policy.response_delay_min_ms ?? 500) +
                1),
          ) + (personaRuntime.policy.response_delay_min_ms ?? 500)
        : 0;
      const ttl = personaRuntime?.policy.reaction_ttl_ms ?? 30000;
      this.pending = {
        sessionId: this.store.sessionId,
        decision: d,
        input,
        persona,
        expires: Math.min(this.runtime.now() + ttl, triggerAt + ttl),
        generation,
        ...(personaRuntime ? { notBefore: triggerAt + responseDelay } : {}),
        ...(activeMember && personaRuntime && attemptId
          ? {
              personaSessionId: personaRuntime.id,
              memberId: activeMember.id,
              sessionEpoch: personaRuntime.controlEpoch,
              memberEpoch: activeMember.epoch,
              definitionHash: activeMember.hash,
              attemptId,
            }
          : {}),
      };
      if (attemptId)
        this.store.attempts.finish(attemptId, "candidate", null, d, {
          inputMessages: messages.map((m) => m.id),
          inputTranscripts: transcripts.map((t) => t.id),
          inputFrames: frames.map((f) => f.id),
          configRevision: personaRuntime?.configRevision,
        });
      if (c.manualApproval) this.phase = "awaiting_human_review";
      else {
        const wait = Math.max(
          0,
          (this.pending?.notBefore ?? 0) - this.runtime.now(),
        );
        if (wait) {
          this.phase = "delaying_publication";
          this.scheduling.defer(() => this.approve(), wait);
        } else this.approve();
      }
    } catch (error) {
      if (attemptId && generation === this.generation)
        this.store.attempts.finish(
          attemptId,
          "failed",
          error instanceof Error ? error.message : "model_error",
        );
      if (generation === this.generation) {
        this.rejects++;
        const { issue, details } = this.runtime.issue(error);
        this.trace(
          "attempt_error",
          { code: issue.code, ...details },
          activeMember?.id,
        );
        const stopState = this.recovery.failed(issue, this.runtime.now());
        if (stopState) this.stop(stopState);
      }
    } finally {
      this.work.finish(lease);
      if (generation === this.generation && this.state === "running") {
        if (!this.pending) this.phase = "random_wait";
        const { minSeconds, maxSeconds } = c.pacing;
        const intervalSeconds =
          minSeconds +
          Math.floor(this.random() * (maxSeconds - minSeconds + 1));
        this.lastAttempt = this.runtime.now() + intervalSeconds * 1000;
      }
    }
  }
  async callModel(input: ModelInput<Bytes>, signal: AbortSignal) {
    const memberId = this.store
      .personaRuntime()
      ?.members.find((member) => member.displayName === input.persona.name)?.id;
    return callMeteredModel({
      input,
      signal,
      policy: this.config.ai,
      model: this.model,
      usage: this.store,
      now: () => this.runtime.now(),
      trace: (event, details) => this.trace(event, details, memberId),
    });
  }
  private currentEvidence(
    input: ModelInput<Bytes>,
    decision: Decision,
  ): CurrentEvidence {
    const ids = new Set([
      ...input.messages.map((message) => message.id),
      ...decision.evidenceMessageIds,
    ]);
    if (decision.replyToMessageId) ids.add(decision.replyToMessageId);
    const messages = new Map<string, string>();
    for (const id of ids) {
      const message = this.store.publicMessage(id);
      if (message) messages.set(id, message.text.slice(0, 500));
    }
    return {
      messages,
      frames: new Set(
        decision.evidenceFrameIds.filter((id) => this.capture.has(id)),
      ),
      transcripts: new Set(
        decision.evidenceTranscriptIds.filter((id) =>
          this.transcriber?.has(id),
        ),
      ),
      recentVideo: this.capture.recent().length > 0,
      privacyRevision: this.store.participation?.revision,
    };
  }
  approve() {
    const p = this.pending;
    if (!p) return;
    const problem = publicationProblem(p, {
      ...this.currentEvidence(p.input, p.decision),
      generation: this.generation,
      sessionId: this.store.sessionId,
      now: this.runtime.now(),
      running: this.state === "running",
      closed: this.store.closed(),
    });
    if (problem) {
      this.pending = undefined;
      this.scheduling.cancelDispatch();
      this.trace("publication_discarded", { reason: problem }, p.memberId);
      if (p.attemptId)
        this.store.attempts.finish(p.attemptId, "expired", problem);
      this.phase = this.state === "running" ? "waiting_for_input" : this.state;
      return;
    }
    if (p.notBefore && p.notBefore > this.runtime.now()) {
      this.scheduling.defer(
        () => this.approve(),
        p.notBefore - this.runtime.now(),
      );
      this.phase = "delaying_publication";
      return;
    }
    this.scheduling.cancelDispatch();
    this.pending = undefined;
    const d = p.decision;
    const now = this.runtime.now();
    this.phase = "publishing_local";
    if (
      p.personaSessionId &&
      p.memberId &&
      p.attemptId &&
      p.sessionEpoch !== undefined &&
      p.memberEpoch !== undefined
    ) {
      const canPublish = this.store.dispatch.claim({
        sessionId: p.personaSessionId,
        memberId: p.memberId,
        sessionEpoch: p.sessionEpoch,
        memberEpoch: p.memberEpoch,
        attemptId: p.attemptId,
      });
      if (!canPublish) {
        this.trace(
          "publication_discarded",
          { reason: "stale_epoch_or_state" },
          p.memberId,
        );
        this.store.attempts.finish(
          p.attemptId,
          "suppressed",
          "stale_epoch_or_state",
        );
        this.phase = "suppressed";
        return;
      }
      const publicMessageId = this.store.publishPersona({
        attemptId: p.attemptId,
        memberId: p.memberId,
        sourceMessageIds: p.input.messages.map((message) => message.id),
        name:
          this.store.personaRuntime()?.members.find((m) => m.id === p.memberId)
            ?.displayName ?? p.input.persona.name,
        text: d.text!,
        replyToId: d.replyToMessageId,
      });
      if (!publicMessageId) {
        this.trace(
          "publication_discarded",
          { reason: "publication_failed" },
          p.memberId,
        );
        this.store.attempts.finish(
          p.attemptId,
          "suppressed",
          "publication_failed",
        );
        this.phase = "suppressed";
        return;
      }
      this.lastSpoke = now;
      this.phase = "published_local";
      this.trace("published", {}, p.memberId);
      this.personaTimes[p.persona] = now;
      this.speechTimes = this.speechTimes.filter((t) => t > now - 60000);
      this.speechTimes.push(now);
      return;
    }
    const published = this.store.publishSynthetic({
      actor: `persona-${p.persona}`,
      name:
        this.config.ai.personas[p.persona].name
          .replace(/\s*·\s*experiment\s*$/i, "")
          .trim() || "시청자",
      text: d.text!,
      replyToId: d.replyToMessageId,
      sourceMessageIds: p.input.messages.map((message) => message.id),
    });
    if (!published) {
      this.trace(
        "publication_discarded",
        { reason: "publication_failed" },
        p.memberId,
      );
      this.phase = "suppressed";
      return;
    }
    this.lastSpoke = now;
    this.phase = "published_local";
    this.trace("published", {}, p.memberId);
    this.personaTimes[p.persona] = now;
    this.speechTimes = this.speechTimes.filter((t) => t > now - 60000);
    this.speechTimes.push(now);
  }
  reject() {
    this.scheduling.cancelDispatch();
    if (this.pending?.attemptId)
      this.store.attempts.finish(
        this.pending.attemptId,
        "suppressed",
        "operator_rejected",
      );
    this.pending = undefined;
    this.rejects++;
  }
}
