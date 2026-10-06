import { z } from "zod";
export const transcriptSchema = z.object({
  id: z.string().min(1).max(100),
  capturedAt: z.number().int().nonnegative(),
  text: z
    .string()
    .max(1000)
    .refine((text) => text.trim().length > 0),
});
export const storedTranscriptSchema = transcriptSchema.extend({
  sessionId: z.string().min(1),
});
export type Transcript = z.infer<typeof transcriptSchema>;
export type StoredTranscript = z.infer<typeof storedTranscriptSchema>;
