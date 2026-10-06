import { z } from "zod";
export const soopBroadcastSchema = z.object({
  broadcastId: z.string().min(1).max(100),
});
export const soopSessionSchema = soopBroadcastSchema.extend({
  clientId: z.string().min(1),
  accessToken: z.string().min(1),
  streamerId: z.string().min(1),
});
export const soopStatusSchema = soopBroadcastSchema.extend({
  state: z.enum([
    "connecting",
    "subscribed",
    "disconnected",
    "permission_blocked",
    "failed",
  ]),
});
export const soopMessageSchema = soopBroadcastSchema
  .extend({
    userId: z.string().min(1).max(256),
    userNickname: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();
export const soopNoticeFailedSchema = soopBroadcastSchema
  .extend({ id: z.string().uuid() })
  .strict();

export type SoopSession = z.infer<typeof soopSessionSchema>;
