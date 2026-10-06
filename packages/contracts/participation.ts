import { z } from "zod";
import { privacyProfileSchema } from "./privacy-profile.ts";
import { rightsRecordSchema, videoRecordSchema } from "./rights.ts";

export const participantStatusSchema = z.object({
  id: z.string(),
  platform: z.string(),
  broadcaster: z.string(),
  account: z.string(),
  state: z.enum([
    "UNCONSENTED",
    "WAITING_CONSENT",
    "ACTIVE",
    "WITHDRAWN",
    "ENDED",
  ]),
  age: z.enum(["unknown", "self_declared_14_plus", "blocked"]),
  stage: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  deliveredAt: z.number().nullable(),
  observed: z
    .object({ id: z.string(), receivedAt: z.number(), command: z.string() })
    .optional(),
  notice: z
    .object({ stage: z.literal("combined").optional(), text: z.string() })
    .nullable(),
});
export const participationStatusSchema = z.object({
  generatedAt: z.number(),
  pendingFollowups: z.number().int().nonnegative(),
  noticeBot: z.string(),
  youtubeNoticeBot: z.string(),
  chzzkNoticeBot: z.string(),
  profile: privacyProfileSchema,
  issues: z.array(z.string()),
  participants: z.array(participantStatusSchema),
  rights: z.array(rightsRecordSchema),
  videos: z.array(videoRecordSchema),
});
export type ParticipationStatus = z.infer<typeof participationStatusSchema>;
export type ParticipantStatus = z.infer<typeof participantStatusSchema>;
