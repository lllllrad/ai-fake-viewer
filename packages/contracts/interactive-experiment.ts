import { z } from "zod";
import { castRuntimeSchema } from "./cast-runtime.ts";
import { publicMessageSchema } from "./conversation.ts";

export const experimentStartSchema = z
  .object({
    topic: z.string().trim().min(1).max(500),
    provider: z.enum(["fixture", "openai_api", "chatgpt_subscription"]),
    maxCalls: z.number().int().min(1).max(100).default(12),
  })
  .strict();
export type ExperimentStart = z.infer<typeof experimentStartSchema>;
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
});
export type ExperimentSession = z.infer<typeof experimentSessionSchema>;
export const experimentIndexSchema = z.object({
  activeId: z.string().nullable(),
  microphoneReady: z.boolean(),
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
      at: z.number(),
      elapsedMs: z.number(),
      request: z.unknown(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    }),
  ),
  diagnostics: z.array(z.unknown()),
  attempts: z.array(z.unknown()),
});
export type ExperimentTrace = z.infer<typeof experimentTraceSchema>;
