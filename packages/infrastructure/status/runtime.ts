import type { AdminStatus } from "../../contracts/admin-status.ts";
import type { BroadcastReadiness } from "../../contracts/readiness.ts";
import type { Config } from "../../config.ts";
import type { Store } from "../../storage.ts";
import type { Capture } from "../../capture.ts";
import type { Transcriber } from "../../transcription.ts";
import type { Scheduler } from "../../scheduler.ts";
import type { Supervisor } from "../inputs/platform-supervisor.ts";
import type { BroadcastCast } from "../../application/cast/broadcast-cast.ts";
import type { RightsService } from "../../application/rights/service.ts";
import type { ChatgptAuth } from "../../chatgpt-auth.ts";
import type { YoutubeAuth } from "../../youtube-auth.ts";
import type { ChzzkAuth } from "../../chzzk.ts";
import type { SoopAuth } from "../../soop.ts";
import { apiIssues } from "../../api-health.ts";
import { profileIssues } from "../../privacy-profile.ts";

interface RuntimeStatusDependencies {
  demo: boolean;
  config: Config;
  store: Pick<
    Store,
    | "originsRevealed"
    | "sessionId"
    | "closed"
    | "aiDesiredRunning"
    | "chatSummary"
    | "transcriptCount"
    | "transcriptRows"
    | "usage"
    | "consentNoticeEnabled"
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
    | "gate"
    | "skips"
    | "rejects"
  >;
  supervisor: Pick<Supervisor, "states" | "youtubeNotices" | "chzzkNotices">;
  personas: Pick<BroadcastCast, "automaticSummary">;
  rights: Pick<RightsService, "list">;
  chatgpt: Pick<ChatgptAuth, "active" | "status">;
  youtubeAuth: Pick<YoutubeAuth, "configured" | "connected" | "channelId">;
  auth: Pick<ChzzkAuth, "token">;
  soopAuth: Pick<SoopAuth, "token">;
  privacyReady(): boolean;
  readyComponents(): BroadcastReadiness;
  now(): number;
  credentials(): {
    speech: boolean;
    youtube: boolean;
    chzzk: boolean;
    soop: boolean;
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
      supervisor,
      personas,
      rights,
      chatgpt,
      youtubeAuth,
      auth,
      soopAuth,
      privacyReady,
      readyComponents,
    } = this.dependencies;
    const now = this.dependencies.now();
    const credentials = this.dependencies.credentials();
    const speech = transcriber.recent();
    const latestFrame = capture.latest();
    return {
      demo: demo,
      generatedAt: now,
      originsRevealed: store.originsRevealed(),
      sessionId: store.sessionId,
      closed: store.closed(),
      broadcastEnded: Object.values(supervisor.states).some(
        (connector) => connector.state === "ended",
      ),
      aiDesiredRunning: store.aiDesiredRunning(),
      personas: personas.automaticSummary(),
      chatSummary: store.chatSummary(),
      privacy: {
        memoryOnly: demo || config.database === ":memory:",
        ready: privacyReady(),
        issues: profileIssues(config.privacy),
        pendingRights: rights
          .list()
          .filter((r) => !["completed", "limited"].includes(r.state)).length,
      },
      retentionDays: config.retentionDays,
      connectors: supervisor.states,
      apiIssues: apiIssues({
        youtubeRead: supervisor.states.youtube,
        chzzkRead: supervisor.states.chzzk,
        youtubeSend: supervisor.youtubeNotices ?? { state: "disabled" },
        chzzkSend: supervisor.chzzkNotices ?? { state: "disabled" },
        audioState: transcriber.state,
        modelState: scheduler.state,
        modelIssue: scheduler.lastIssue,
      }),
      audio: {
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
        gate: {
          enabled: config.ai.gate.enabled,
          state: demo
            ? "demo_bypass"
            : config.ai.gate.enabled
              ? scheduler.gate.state
              : "disabled",
          requests: scheduler.gate.requests,
          maxRequests: config.ai.gate.maxRequests,
          filtered: scheduler.gate.filtered,
          errors: scheduler.gate.errors,
          probability: scheduler.gate.probability,
          suppressThreshold: config.ai.gate.threshold,
        },
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
        maxCalls: config.ai.maxCalls,
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
        youtube: {
          oauthConfigured: youtubeAuth.configured,
          connected: youtubeAuth.connected,
          channelId: youtubeAuth.channelId ?? null,
          redirectUri: config.youtube.redirectUri,
          noticeState: supervisor.youtubeNotices?.state ?? "disabled",
          enabled: config.youtube.enabled,
          consentNoticeEnabled: store.consentNoticeEnabled(
            "youtube",
            config.youtube.consentNoticeEnabled,
          ),
          credentialsConfigured: !!(
            youtubeAuth.connected || credentials.youtube
          ),
          videoConfigured: !!config.youtube.video,
          channelConfigured: !!config.youtube.channelId,
        },
        chzzk: {
          enabled: config.chzzk.enabled,
          tokenConfigured: !!auth.token,
          consentNoticeEnabled: store.consentNoticeEnabled(
            "chzzk",
            config.chzzk.consentNoticeEnabled,
          ),
          credentialsConfigured: !!credentials.chzzk,
          redirectUri: config.chzzk.redirectUri,
        },
        soop: {
          mode: config.soop.mode,
          consentNoticeEnabled: store.consentNoticeEnabled(
            "soop",
            config.soop.consentNoticeEnabled,
          ),
          streamerConfigured: !!config.soop.streamerId,
          credentialsConfigured: !!credentials.soop,
          tokenConfigured: !!soopAuth.token,
          redirectUri: config.soop.redirectUri,
        },
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
      messages: store.readerSnapshot().messages,
    };
  }
}
