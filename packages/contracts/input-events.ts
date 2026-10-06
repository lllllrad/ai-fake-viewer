import { z } from "zod";
const timestamp = z.number().int().nonnegative();
const dimension = z.number().int().positive().max(16777216);
export const frameEventSchema = z.object({
  type: z.literal("frame"),
  capturedAt: timestamp,
  width: dimension.max(1280),
  height: dimension.max(1280),
  sourceWidth: dimension.optional(),
  sourceHeight: dimension.optional(),
  bytes: z
    .string()
    .min(4)
    .max(4 * 1024 * 1024 - 1),
});
export const audioEventSchema = z.object({
  type: z.literal("audio"),
  capturedAt: timestamp,
  pcm: z.string(),
});
export const activityEventSchema = z.object({
  type: z.literal("activity"),
  capturedAt: timestamp,
});
