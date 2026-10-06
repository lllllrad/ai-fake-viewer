import { z } from "zod";
export const rightsIntakeSchema = z
  .object({
    contact: z.string().max(300).default(""),
    platform: z.string().trim().min(1).max(40),
    account: z.string().trim().min(1).max(256),
    session: z.string().trim().min(1).max(100),
    broadcaster: z.string().max(256).default(""),
    videoUrl: z.string().max(500).default(""),
    segment: z.string().max(100).default(""),
  })
  .strict();
export const rightsUpdateSchema = z
  .object({
    state: z.enum([
      "received",
      "verifying",
      "app_done",
      "external_pending",
      "completed",
      "limited",
    ]),
    appDone: z.boolean(),
    providerDone: z.boolean(),
    videoDone: z.boolean(),
    copiesDone: z.boolean(),
    outcome: z
      .enum([
        "pending",
        "masked",
        "muted",
        "segment_removed",
        "unpublished",
        "deleted",
        "no_identifiable_data",
        "provider_requested",
        "outside_control",
      ])
      .default("pending"),
  })
  .strict();

export const rightsRecordSchema = rightsIntakeSchema.extend({
  ...rightsUpdateSchema.shape,
  id: z.string(),
  requestIds: z.array(z.string()).max(100),
  createdAt: z.number(),
});
export const videoIntakeSchema = z
  .object({
    platform: z.enum(["soop", "chzzk", "youtube", "local"]),
    url: z.string().min(1).max(500),
    broadcastAt: z.string().min(1).max(80),
    status: z.enum(["public", "private", "removed", "local_copy"]),
  })
  .strict();
export const videoRecordSchema = videoIntakeSchema.extend({ id: z.string() });
export type RightsIntake = z.input<typeof rightsIntakeSchema>;
export type RightsRecord = z.infer<typeof rightsRecordSchema>;
export type RightsUpdate = z.infer<typeof rightsUpdateSchema>;
export type VideoRecord = z.infer<typeof videoRecordSchema>;
