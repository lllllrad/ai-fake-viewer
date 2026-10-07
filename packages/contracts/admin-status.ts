import { z } from "zod";
import { publicMessageSchema } from "./conversation.ts";
import { broadcastReadinessSchema } from "./readiness.ts";

const count = z.number().int().nonnegative();
const time = z.number().min(0).max(8.64e15);
const provider = z.enum(["chatgpt_subscription", "openai_api"]);
const visualMode = z.enum(["on_request", "continuous"]);
const connector = z.object({
  state: z.string(),
  api: z.string().optional(),
  recoveries: count,
  received: count,
  lastReceived: time.nullable(),
});
export const transcriptStatusSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  capturedAt: time,
  text: z.string(),
});
const castMember = z.object({
  id: z.string(),
  name: z.string(),
  motive: z.string(),
  participation: z.string(),
});
const summary = z.object({
  version: z.literal(1),
  state: z.enum(["available", "insufficient_data"]),
  topics: z.array(z.string()),
  atmosphere: z.array(z.string()),
  activity: z.enum(["unknown", "quiet", "active", "busy"]),
});
const account = z.object({
  clientId: z.string(),
  email: z.string().nullable(),
  connected: z.boolean(),
  model: z.string().nullable(),
});

/** Explicit administrator projection. Unknown fields never reach the UI or escape the server. */
export const adminStatusSchema = z.object({
  demo: z.boolean(),
  generatedAt: time,
  originsRevealed: z.boolean(),
  sessionId: z.string(),
  closed: z.boolean(),
  broadcastEnded: z.boolean(),
  aiDesiredRunning: z.boolean(),
  personas: z.array(castMember),
  chatSummary: summary,
  privacy: z.object({
    memoryOnly: z.boolean(),
    ready: z.boolean(),
    issues: z.array(z.string()),
    pendingRights: count,
  }),
  retentionDays: z.number(),
  connectors: z.record(z.string(), connector),
  apiIssues: z.array(
    z.object({ api: z.string(), operation: z.string(), message: z.string() }),
  ),
  audio: z.object({
    provider: z.enum(["groq", "openai"]).default("groq"),
    state: z.string(),
    configured: z.boolean(),
    credentialsReady: z.boolean(),
    requests: count,
    maxRequests: count,
    language: z.string(),
    latestAt: time.nullable(),
    transcriptCount: count,
    latestText: z.string().nullable(),
    loggedCount: count,
    history: z.array(transcriptStatusSchema),
  }),
  capture: z.object({
    state: z.string(),
    configured: z.boolean(),
    lastFrameAt: time.nullable(),
    dimensions: z.string(),
    lastError: z.string(),
    ffmpeg: z.string(),
    backend: z.string(),
    device: z.string(),
    lastFrameAgeMs: z.number().nonnegative().nullable(),
    framesInLastMinute: count,
    masks: z.array(
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
    ),
  }),
  ai: z.object({
    state: z.string(),
    manualApproval: z.boolean(),
    pacing: z.object({ minSeconds: z.number(), maxSeconds: z.number() }),
    contextWindowSeconds: z.number(),
    busy: z.boolean(),
    phase: z.string(),
    lastIssue: z
      .object({
        code: z.string(),
        message: z.string(),
        at: time,
        continuing: z.boolean(),
      })
      .optional(),
    diagnostics: z.array(
      z.object({
        at: time,
        event: z.string(),
        phase: z.string(),
        details: z.record(z.string(), z.union([z.string(), z.number()])),
      }),
    ),
    reviewDraft: z.boolean(),
    reviewCount: count,
    input: z.object({
      audioChunkSeconds: z.number(),
      audioLanguage: z.string(),
      contextWindowSeconds: z.number(),
      visualMode,
      last: z.object({
        newTranscripts: count,
        contextTranscripts: count,
        newMessages: count,
        contextMessages: count,
        frames: count,
      }),
      availableTools: z.array(z.string()),
    }),
    pending: z
      .object({ text: z.string().nullable(), expires: time })
      .nullable(),
    gate: z.object({
      enabled: z.boolean(),
      state: z.string(),
      requests: count,
      maxRequests: count,
      filtered: count,
      errors: count,
      probability: z.number().nullable(),
      suppressThreshold: z.number(),
    }),
    skips: count,
    rejects: count,
    usage: z.object({
      calls: count,
      reservedUsd: z.number(),
      inputTokens: count.nullable(),
      outputTokens: count.nullable(),
    }),
    costEstimate: z.enum(["unavailable", "configured_prices"]),
    maxCalls: count,
    provider,
    visualMode,
    readiness: broadcastReadinessSchema,
    model: z.string(),
  }),
  chatgpt: z.object({
    active: z.string().nullable(),
    accounts: z.array(account),
  }),
  setup: z.object({
    youtube: z.object({
      oauthConfigured: z.boolean(),
      connected: z.boolean(),
      channelId: z.string().nullable(),
      redirectUri: z.string(),
      noticeState: z.string(),
      enabled: z.boolean(),
      consentNoticeEnabled: z.boolean(),
      credentialsConfigured: z.boolean(),
      videoConfigured: z.boolean(),
      channelConfigured: z.boolean(),
    }),
    chzzk: z.object({
      enabled: z.boolean(),
      tokenConfigured: z.boolean(),
      consentNoticeEnabled: z.boolean(),
      credentialsConfigured: z.boolean(),
      redirectUri: z.string(),
    }),
    soop: z.object({
      mode: z.enum(["disabled", "official", "experimental_library"]),
      consentNoticeEnabled: z.boolean(),
      streamerConfigured: z.boolean(),
      credentialsConfigured: z.boolean(),
      tokenConfigured: z.boolean(),
      redirectUri: z.string(),
    }),
    audio: z.object({ credentialsConfigured: z.boolean() }),
    ai: z.object({
      provider,
      connected: z.boolean(),
      modelSelected: z.boolean(),
    }),
  }),
  messages: z.array(publicMessageSchema),
});
export type AdminStatus = z.infer<typeof adminStatusSchema>;
