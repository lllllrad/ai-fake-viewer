import { z } from "zod";

/** Explicit application state supplied by an implementation, never inferred private reasoning. */
export const viewerInspectionSchema = z.object({
  memberId: z.string(),
  status: z.string(),
  updatedAt: z.number().nullable(),
  sections: z.array(z.object({ label: z.string(), value: z.json() })),
});
export type ViewerInspection = z.infer<typeof viewerInspectionSchema>;
