import { createHash } from "node:crypto";
import { z } from "zod";
export const chzzkChatSchema = z.object({
  channelId: z.string(),
  senderChannelId: z.string(),
  profile: z.object({ nickname: z.string() }),
  content: z.string().min(1).max(4000),
  messageTime: z.number().int().nonnegative(),
});
export function normalizeChzzk(raw: unknown) {
  const e = chzzkChatSchema.parse(
    typeof raw === "string" ? JSON.parse(raw) : raw,
  );
  return {
    platform: "chzzk" as const,
    channel: e.channelId,
    author: e.senderChannelId,
    name: e.profile.nickname,
    text: e.content,
    // Local replay identity, not a provider-issued message ID or receive timestamp.
    sourceId: `chzzk-event:${createHash("sha256")
      .update(
        JSON.stringify([
          e.channelId,
          e.senderChannelId,
          e.messageTime,
          e.content,
        ]),
      )
      .digest("hex")}`,
  };
}
