import { z } from "zod";
import {
  displayChatSchema,
  type DisplayChat,
} from "../../contracts/display-chat.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function normalizeYoutube(
  value: unknown,
  chat: string,
): DisplayChat | null {
  const item = record(value),
    snippet = record(item.snippet);
  if (
    !["textMessageEvent", "TEXT_MESSAGE_EVENT", 1].includes(
      snippet.type as string | number,
    )
  )
    return null;
  const author = record(item.authorDetails ?? item.author_details);
  const details = record(
    snippet.textMessageDetails ?? snippet.text_message_details,
  );
  const text =
    snippet.displayMessage ??
    snippet.display_message ??
    details.messageText ??
    details.message_text;
  if (typeof item.id !== "string" || !item.id) return null;
  const parsed = displayChatSchema.safeParse({
    platform: "youtube",
    channel: chat,
    sourceId: item.id,
    author:
      author.channelId ??
      author.channel_id ??
      snippet.authorChannelId ??
      snippet.author_channel_id,
    name: author.displayName ?? author.display_name ?? "YouTube viewer",
    text,
  });
  return parsed.success ? parsed.data : null;
}

const offline = z
  .union([z.iso.datetime({ offset: true }), z.literal("")])
  .optional();
const pageSchema = z.object({
  items: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
  next_page_token: z.string().optional(),
  offlineAt: offline,
  offline_at: offline,
  pollingIntervalMillis: z
    .number()
    .int()
    .nonnegative()
    .max(2147483647)
    .optional(),
});
export function youtubeChatBatch(
  value: unknown,
  target: { chat: string; broadcaster?: string },
  transport: "rest" | "grpc",
) {
  const page = pageSchema.parse(value);
  const messages: DisplayChat[] = [];
  for (const item of page.items) {
    const message = normalizeYoutube(item, target.broadcaster ?? target.chat);
    if (message) messages.push(message);
  }
  return {
    messages,
    cursor:
      (transport === "rest" ? page.nextPageToken : page.next_page_token) ?? "",
    ended: !!(transport === "rest" ? page.offlineAt : page.offline_at),
    pollIntervalMs: Math.max(1000, page.pollingIntervalMillis || 5000),
  };
}
