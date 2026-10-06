import { z } from "zod";

export const readinessCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  ready: z.boolean(),
  optional: z.boolean().optional(),
});
export const broadcastReadinessSchema = z.object({
  ready: z.boolean(),
  checks: z.array(readinessCheckSchema),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export type BroadcastReadiness = z.infer<typeof broadcastReadinessSchema>;
