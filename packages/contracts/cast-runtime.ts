import { z } from "zod";
import { definitionSchema } from "./persona-definition.ts";
import { briefSchema, policySchema } from "./cast-configuration.ts";
export const castPresenceSchema = z.object({
  joined_after_seq: z.number().int().nonnegative(),
  left_after_seq: z.number().int().nonnegative().nullable(),
  joined_at: z.number(),
  left_at: z.number().nullable(),
});
export const castRuntimeSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  armed: z.boolean(),
  controlEpoch: z.number().int().nonnegative(),
  configRevision: z.number().int().nonnegative(),
  policy: policySchema,
  brief: briefSchema,
  members: z.array(
    z.object({
      id: z.string().min(1),
      personaId: z.string().min(1),
      versionId: z.string().min(1),
      snapshot: definitionSchema,
      hash: z.string().min(1),
      displayName: z.string().min(1),
      epoch: z.number().int().nonnegative(),
      attention: z.number().min(0).max(1),
      focusTags: z.array(z.string()),
      guessingEligible: z.boolean(),
      lastPublishedAt: z.number().nullable(),
      consecutiveMessages: z.number().int().nonnegative(),
      presence: z.array(castPresenceSchema),
    }),
  ),
});
export type CastRuntime = z.infer<typeof castRuntimeSchema>;
