import type { AdminStatus } from "../../contracts/admin-status.ts";
import type { BroadcastReadiness } from "../../contracts/readiness.ts";
import type { Config } from "../../config.ts";
import type { Store } from "../../storage.ts";
import type { Capture } from "../inputs/screen-input.ts";
import type { Transcriber } from "../inputs/speech-input.ts";
import type { Scheduler } from "../reactions/scheduler.ts";
import type { BroadcastCast } from "../../application/cast/broadcast-cast.ts";
import type { ChatgptAuth } from "../accounts/chatgpt-auth.ts";
import { apiIssues } from "../../api-health.ts";

interface RuntimeStatusDependencies {
  demo: boolean;
  config: Config;
  store: Pick<
    Store,
    | "originsRevealed"
    | "sessionId"
    | "closed"
    | "aiDesiredRunning"
    | "transcriptCount"
    | "transcriptRows"
    | "usage"
    | "readerSnapshot"
  >;
  capture: Pick<
    Capture,
    "state" | "latest" | "dimensions" | "lastError" | "frames"
  >;
  transcriber: Pick<Transcriber, "state" | "requests" | "recent">;
  scheduler: Pick<
    Scheduler,
    | "state"
    | "lastIssue"
    | "busy"
    | "phase"
    | "diagnostics"
    | "reviews"
    | "lastInput"
    | "pending"
    | "skips"
    | "rejects"
  >;
  personas: Pick<BroadcastCast, "automaticSummary">;
  chatgpt: Pick<ChatgptAuth, "active" | "status">;
  readyComponents(): BroadcastReadiness;
  displayMessages?(): ReturnType<Store["readerSnapshot"]>["messages"];
  now(): number;
  credentials(): {
    speech: boolean;
    apiKey: boolean;
    apiModel?: string;
  };
}

/** Read current adapters once per media source; never cache broadcast content. */
export class RuntimeStatusSource {
  constructor(private readonly dependencies: RuntimeStatusDependencies) {}
  read(): AdminStatus {
    const {
      demo,
      config,
      store,
      capture,
      transcriber,
      scheduler,
      personas,
      chatgpt,
      readyComponents,
    } = this.dependencies;
    const now = this.dependencies.now();
    const credentials = this.dependencies.credentials();
    const speech = transcriber.recent();
    const latestFrame = capture.latest();
    return {
      demo: demo,
      inputMode: config.input.mode,
      generatedAt: now,
      originsRevealed: store.originsRevealed(),
      sessionId: store.sessionId,
      closed: store.closed(),
      aiDesiredRunning: store.aiDesiredRunning(),
      personas: personas.automaticSummary(),
      retentionDays: config.retentionDays,
      apiIssues: apiIssues({
        audioState: transcriber.state,
        audioProvider: config.audio.provider,
        modelState: scheduler.state,
        modelIssue: scheduler.lastIssue,
      }),
      audio: {
        provider: config.audio.provider,
        state: transcriber.state,
        configured: !!config.audio.url,
        credentialsReady: credentials.speech,
        requests: transcriber.requests,
        maxRequests: config.audio.maxRequests,
        language: config.audio.language || "auto",
        latestAt: speech.at(-1)?.capturedAt ?? null,
        transcriptCount: speech.length,
        latestText: speech.at(-1)?.text ?? null,
        loggedCount: store.transcriptCount(),
        history: store.transcriptRows(),
      },
      capture: {
        state: capture.state,
        configured:
          config.capture.backend === "rtmp"
            ? !!config.capture.url
            : !!config.capture.device,
        lastFrameAt: latestFrame?.capturedAt ?? null,
        dimensions: capture.dimensions,
        lastError: capture.lastError,
        ffmpeg: config.capture.ffmpeg,
        backend: config.capture.backend,
        device: config.capture.backend === "rtmp" ? "" : config.capture.device,
        lastFrameAgeMs: latestFrame
          ? Math.max(0, now - latestFrame!.capturedAt)
          : null,
        framesInLastMinute: capture.frames.filter(
          (f) => f.capturedAt > now - 60000,
        ).length,
        masks: config.capture.masks,
      },
      ai: {
        state: scheduler.state,
        manualApproval: config.ai.manualApproval,
        pacing: config.ai.pacing,
        contextWindowSeconds: config.ai.contextWindowSeconds,
        busy: scheduler.busy,
        phase: scheduler.phase,
        lastIssue: scheduler.lastIssue,
        diagnostics: scheduler.diagnostics,
        reviewDraft: config.ai.reviewDraft,
        reviewCount: scheduler.reviews,
        input: {
          audioChunkSeconds: config.audio.chunkSeconds,
          audioLanguage: config.audio.language || "auto",
          contextWindowSeconds: config.ai.contextWindowSeconds,
          visualMode: config.ai.visualMode,
          last: scheduler.lastInput,
          availableTools: [],
        },
        pending: scheduler.pending
          ? {
              text: scheduler.pending.decision.text,
              expires: scheduler.pending.expires,
            }
          : null,
        skips: scheduler.skips,
        rejects: scheduler.rejects,
        usage: store.usage(),
        costEstimate:
          config.ai.provider === "chatgpt_subscription" ||
          config.ai.inputUsdPerMillion === null ||
          config.ai.outputUsdPerMillion === null ||
          !config.ai.priceCheckedAt
            ? "unavailable"
            : "configured_prices",
        provider: config.ai.provider,
        visualMode: config.ai.visualMode,
        readiness: readyComponents(),
        model: demo
          ? "mock"
          : config.ai.provider === "chatgpt_subscription"
            ? (chatgpt.active?.model ?? "not selected")
            : (credentials.apiModel ?? "not configured"),
      },
      chatgpt: chatgpt.status,
      setup: {
        audio: {
          credentialsConfigured: credentials.speech,
        },
        ai: {
          provider: config.ai.provider,
          connected:
            config.ai.provider === "chatgpt_subscription"
              ? !!chatgpt.active?.refreshToken
              : !!(credentials.apiKey && credentials.apiModel),
          modelSelected:
            config.ai.provider === "chatgpt_subscription"
              ? !!chatgpt.active?.model
              : !!credentials.apiModel,
        },
      },
      messages:
        this.dependencies.displayMessages?.() ??
        store.readerSnapshot().messages,
    };
  }
}
