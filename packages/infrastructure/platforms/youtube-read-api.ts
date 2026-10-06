import { z } from "zod";
export type YoutubeReadPath = "search" | "videos" | "liveChat/messages";
export class UpstreamError extends Error {
  constructor(
    public state: string,
    public retryMs = 0,
    public api = "YouTube Data API",
  ) {
    super(state);
  }
}
export function videoId(input: string) {
  if (/^[\w-]{11}$/.test(input)) return input;
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw Error("Invalid YouTube video ID");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("Invalid YouTube URL");
  let id = "";
  if (u.hostname === "youtu.be") id = u.pathname.slice(1);
  else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname)
  ) {
    id =
      u.pathname === "/watch"
        ? (u.searchParams.get("v") ?? "")
        : (u.pathname.match(/^\/live\/([\w-]{11})\/?$/)?.[1] ?? "");
  }
  if (!/^[\w-]{11}$/.test(id)) throw Error("Invalid YouTube video ID");
  return id;
}

const errorSchema = z.object({
  error: z
    .object({
      errors: z.array(z.object({ reason: z.string().optional() })).optional(),
    })
    .optional(),
});
const searchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z
          .object({
            videoId: z
              .string()
              .regex(/^[\w-]{11}$/)
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
const videosSchema = z.object({
  items: z
    .array(
      z.object({
        liveStreamingDetails: z
          .object({ activeLiveChatId: z.string().min(1).max(256).optional() })
          .optional(),
        snippet: z
          .object({ channelId: z.string().min(1).max(256).optional() })
          .optional(),
      }),
    )
    .default([]),
});
const apiName = (path: YoutubeReadPath) =>
  path === "liveChat/messages"
    ? "YouTube liveChatMessages.list"
    : `YouTube ${path}.list`;

/** Read-only HTTP and typed broadcast discovery; no ingestion or notice policy. */
export class YoutubeReadApi {
  constructor(
    private readonly access?: () => Promise<string>,
    private readonly request: typeof fetch = fetch,
  ) {}
  async json(
    path: YoutubeReadPath,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      signal.throwIfAborted();
      const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
      const headers: Record<string, string> = {};
      if (this.access) headers.Authorization = `Bearer ${await this.access()}`;
      else if (process.env.YOUTUBE_ACCESS_TOKEN)
        headers.Authorization = `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}`;
      else url.searchParams.set("key", process.env.YOUTUBE_API_KEY ?? "");
      signal.throwIfAborted();
      const response = await this.request(url, {
        method: "GET",
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      signal.throwIfAborted();
      const body: unknown = await response.json().catch(() => undefined);
      signal.throwIfAborted();
      if (!response.ok) {
        const error = errorSchema.safeParse(body);
        const reason = error.success
          ? (error.data.error?.errors?.[0]?.reason ?? "")
          : "";
        const state = [
          "liveChatEnded",
          "liveChatDisabled",
          "liveChatNotFound",
        ].includes(reason)
          ? "ended"
          : reason === "invalidPageToken"
            ? "invalid_cursor"
            : reason === "invalidChannelId"
              ? "config_required"
              : response.status === 401
                ? "auth_required"
                : response.status === 429
                  ? "quota_blocked"
                  : response.status === 403
                    ? /quota|rateLimit/i.test(reason)
                      ? "quota_blocked"
                      : "permission_blocked"
                    : "reconnecting";
        const seconds = Number(response.headers.get("retry-after") ?? 0);
        throw new UpstreamError(
          state,
          Number.isFinite(seconds) && seconds > 0
            ? Math.min(seconds * 1000, 2147483647)
            : 0,
          apiName(path),
        );
      }
      if (body === undefined)
        throw new UpstreamError("reconnecting", 0, apiName(path));
      return body;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError("reconnecting", 0, apiName(path));
    }
  }
  async search(
    channelId: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const parsed = searchSchema.safeParse(
      await this.json(
        "search",
        {
          part: "snippet",
          channelId,
          eventType: "live",
          type: "video",
          maxResults: "5",
        },
        signal,
      ),
    );
    if (!parsed.success)
      throw new UpstreamError("reconnecting", 0, apiName("search"));
    return parsed.data.items.find((item) => item.id?.videoId)?.id?.videoId;
  }
  async video(input: string, includeBroadcaster: boolean, signal: AbortSignal) {
    const parsed = videosSchema.safeParse(
      await this.json(
        "videos",
        {
          part: includeBroadcaster
            ? "liveStreamingDetails,snippet"
            : "liveStreamingDetails",
          id: videoId(input),
        },
        signal,
      ),
    );
    if (!parsed.success)
      throw new UpstreamError("reconnecting", 0, apiName("videos"));
    const first = parsed.data.items[0];
    return {
      chat: first?.liveStreamingDetails?.activeLiveChatId,
      broadcaster: first?.snippet?.channelId,
    };
  }
  messages(chat: string, cursor: string | undefined, signal: AbortSignal) {
    return this.json(
      "liveChat/messages",
      {
        liveChatId: chat,
        part: "id,snippet,authorDetails",
        maxResults: "500",
        ...(cursor ? { pageToken: cursor } : {}),
      },
      signal,
    );
  }
}
export function googleJson(
  path: YoutubeReadPath,
  params: Record<string, string>,
  signal: AbortSignal,
  access?: () => Promise<string>,
) {
  return new YoutubeReadApi(access).json(path, params, signal);
}
