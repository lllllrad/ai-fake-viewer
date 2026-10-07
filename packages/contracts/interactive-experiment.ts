import { viewerInspectionSchema } from "./reaction-inspection.ts";
import { z } from "zod";
import { castRuntimeSchema } from "./cast-runtime.ts";
import { publicMessageSchema } from "./conversation.ts";

export const experimentStartSchema = z
  .object({
    topic: z.string().trim().min(1).max(500),
    provider: z.enum(["fixture", "openai_api", "chatgpt_subscription"]),
    pipelineType: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/)
      .optional(),
    maxCalls: z.number().int().min(1).max(100).default(12),
  })
  .strict();
export type ExperimentStart = z.infer<typeof experimentStartSchema>;
export const experimentResumeSchema = z
  .object({
    additionalCalls: z.number().int().min(1).max(100).default(12),
  })
  .strict();
export const experimentInputSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();
export const experimentSessionSchema = z.object({
  id: z.string().uuid(),
  topic: z.string(),
  provider: z.string(),
  model: z.string(),
  pipelineType: z.string().default("standard"),
  pipelineRevision: z.number().int().positive().default(1),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  state: z.string(),
  phase: z.string(),
  issue: z.string().nullable(),
  profile: z.object({
    id: z.string(),
    revision: z.number(),
    digest: z.string(),
  }),
  maxCalls: z.number(),
  calls: z.number(),
  microphoneCalls: z.number(),
  inputs: z.array(
    z.object({
      id: z.string(),
      at: z.number(),
      text: z.string(),
      source: z.enum(["text", "microphone"]),
    }),
  ),
  messages: z.array(publicMessageSchema),
  personas: castRuntimeSchema.shape.members,
  viewerStates: z.array(viewerInspectionSchema).default([]),
});
export type ExperimentSession = z.infer<typeof experimentSessionSchema>;
export const experimentIndexSchema = z.object({
  activeId: z.string().nullable(),
  microphoneReady: z.boolean(),
  defaultPipelineType: z.string(),
  pipelineTypes: z.array(
    z.object({
      id: z.string(),
      revision: z.number(),
      label: z.string(),
      description: z.string(),
    }),
  ),
  microphone: z.object({
    provider: z.enum(["groq", "openai"]),
    label: z.string(),
    model: z.string(),
    keyName: z.enum(["GROQ_API_KEY", "OPENAI_API_KEY"]),
    language: z.string(),
    chunkSeconds: z.number(),
    maxRequests: z.number(),
  }),
  sessions: z.array(
    experimentSessionSchema.pick({
      id: true,
      topic: true,
      startedAt: true,
      endedAt: true,
      provider: true,
      state: true,
    }),
  ),
});
export const experimentTraceSchema = z.object({
  session: experimentSessionSchema,
  pipeline: z.unknown(),
  calls: z.array(
    z.object({
      id: z.string().optional(),
      memberId: z.string().optional(),
      personaName: z.string().optional(),
      stage: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      at: z.number(),
      elapsedMs: z.number(),
      request: z.unknown(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    }),
  ),
  diagnostics: z.array(z.unknown()),
  attempts: z.array(z.unknown()),
  personaProvenance: z
    .array(
      z.object({
        personaId: z.string().uuid(),
        provenance: z.record(z.string(), z.unknown()),
      }),
    )
    .default([]),
});
export type ExperimentTrace = z.infer<typeof experimentTraceSchema>;
