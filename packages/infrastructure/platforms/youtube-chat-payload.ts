import { z } from "zod";
import { incomingSchema, type Incoming } from "../../contracts/incoming.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function normalizeYoutube(
  value: unknown,
  chat: string,
): Incoming | null {
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
  const published = snippet.publishedAt ?? snippet.published_at;
  const stamp = typeof published === "string" ? Date.parse(published) : NaN;
  const parsed = incomingSchema.safeParse({
    platform: "youtube",
    channel: chat,
    sourceId: item.id,
    // Provider identity is required for consent; a made-up identity cannot bind a viewer.
    author:
      author.channelId ??
      author.channel_id ??
      snippet.authorChannelId ??
      snippet.author_channel_id,
    name: author.displayName ?? author.display_name ?? "YouTube viewer",
    text,
    publishedAt: Number.isFinite(stamp) && stamp >= 0 ? stamp : null,
  });
  return parsed.success ? parsed.data : null;
}

export function ignoreYoutubeOwnMessage(
  message: Incoming,
  ownChannel: string | undefined,
) {
  return message.author === ownChannel;
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
  target: { chat: string; broadcaster?: string; ownChannel?: string },
  transport: "rest" | "grpc",
) {
  const page = pageSchema.parse(value);
  const messages: Incoming[] = [];
  for (const item of page.items) {
    const message = normalizeYoutube(item, target.broadcaster ?? target.chat);
    if (message && !ignoreYoutubeOwnMessage(message, target.ownChannel))
      messages.push(message);
  }
  return {
    messages,
    cursor:
      (transport === "rest" ? page.nextPageToken : page.next_page_token) ?? "",
    ended: !!(transport === "rest" ? page.offlineAt : page.offline_at),
    pollIntervalMs: Math.max(1000, page.pollingIntervalMillis || 5000),
  };
}
