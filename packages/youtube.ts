import { receiveYoutubeStream } from "./infrastructure/platforms/youtube-grpc.ts";
export { makeGrpcClient } from "./infrastructure/platforms/youtube-grpc.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { youtubeChatBatch } from "./infrastructure/platforms/youtube-chat-payload.ts";
export {
  normalizeYoutube,
  ignoreYoutubeOwnMessage,
} from "./infrastructure/platforms/youtube-chat-payload.ts";
import type { Store } from "./storage.ts";
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
export class UpstreamError extends Error {
  constructor(
    public state: string,
    public retryMs = 0,
    public api = "YouTube Data API",
  ) {
    super(state);
  }
}
export async function googleJson(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
  access?: () => Promise<string>,
) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (access) headers.Authorization = `Bearer ${await access()}`;
  else if (process.env.YOUTUBE_ACCESS_TOKEN)
    headers.Authorization = `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}`;
  else url.searchParams.set("key", process.env.YOUTUBE_API_KEY ?? "");
  const r = await fetch(url, {
    headers,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  const b: any = await r.json();
  if (!r.ok) {
    const reason = b.error?.errors?.[0]?.reason;
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
          : r.status === 401
            ? "auth_required"
            : r.status === 429
              ? "quota_blocked"
              : r.status === 403
                ? /quota|rateLimit/i.test(String(reason))
                  ? "quota_blocked"
                  : "permission_blocked"
                : "reconnecting";
    throw new UpstreamError(
      state,
      Number(r.headers.get("retry-after") ?? 0) * 1000,
      path === "liveChat/messages"
        ? "YouTube liveChatMessages.list"
        : `YouTube ${path}.list`,
    );
  }
  return b;
}
export async function runYoutube(
  config: {
    video: string;
    channelId?: string;
    transport: "grpc" | "rest";
    restFallback: boolean;
  },
  store: Store,
  signal: AbortSignal,
  status: (s: string, api?: string) => void,
  options?: {
    access?: () => Promise<string>;
    resolve?: (chat: string, broadcaster: string) => void;
    ownChannel?: () => string | undefined;
  },
) {
  if (signal.aborted) {
    status("stopped");
    return;
  }
  if (
    !options?.access &&
    !process.env.YOUTUBE_API_KEY &&
    !process.env.YOUTUBE_ACCESS_TOKEN
  ) {
    status("config_required");
    return;
  }
  let chat: string;
  let broadcaster: string | undefined;
  let selectedVideo = config.video.trim();
  try {
    if (!selectedVideo && config.channelId?.trim()) {
      const channelId = config.channelId.trim();
      if (!/^UC[\w-]{22}$/.test(channelId)) {
        status("config_required");
        return;
      }
      const live = await googleJson(
        "search",
        {
          part: "snippet",
          channelId,
          eventType: "live",
          type: "video",
          maxResults: "5",
        },
        signal,
        options?.access,
      );
      if (signal.aborted) {
        status("stopped");
        return;
      }
      selectedVideo =
        live.items?.find((item: any) => typeof item.id?.videoId === "string")
          ?.id.videoId ?? "";
      if (!selectedVideo) {
        status("waiting_live");
        return;
      }
    }
    const b = await googleJson(
      "videos",
      {
        part: store.participation
          ? "liveStreamingDetails,snippet"
          : "liveStreamingDetails",
        id: videoId(selectedVideo),
      },
      signal,
      options?.access,
    );
    if (signal.aborted) {
      status("stopped");
      return;
    }
    chat = b.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (store.participation) {
      broadcaster = b.items?.[0]?.snippet?.channelId;
      if (
        !broadcaster ||
        !store.participation.available("youtube", broadcaster)
      ) {
        status("privacy_blocked");
        return;
      }
    }
    if (chat && broadcaster) options?.resolve?.(chat, broadcaster);
    if (!chat) {
      status("waiting_live");
      return;
    }
  } catch (e) {
    if (signal.aborted) {
      status("stopped");
      return;
    }
    status(
      e instanceof UpstreamError ? e.state : "config_required",
      e instanceof UpstreamError ? e.api : undefined,
    );
    return;
  }
  let transport = config.transport;
  let failures = 0;
  status("connecting");
  while (!signal.aborted) {
    // Normal polling/stream continuation does not disconnect the logical receiver.
    if (failures) status("reconnecting");
    const key = `youtube:${store.sessionId}:${chat}:${transport}`;
    let token = store.checkpoint(key);
    try {
      if (transport === "rest") {
        const b = await googleJson(
          "liveChat/messages",
          {
            liveChatId: chat,
            part: "id,snippet,authorDetails",
            maxResults: "500",
            ...(token ? { pageToken: token } : {}),
          },
          signal,
          options?.access,
        );
        if (signal.aborted) break;
        const batch = youtubeChatBatch(
          b,
          { chat, broadcaster, ownChannel: options?.ownChannel?.() },
          "rest",
        );
        store.ingestion.ingest(batch.messages, { key, value: batch.cursor });
        status("subscribed:rest");
        failures = 0;
        if (batch.ended) {
          status("ended");
          return;
        }
        await sleep(batch.pollIntervalMs, undefined, { signal });
      } else {
        const completion = await receiveYoutubeStream(
          { chat, cursor: token, access: options?.access },
          signal,
          (b) => {
            const batch = youtubeChatBatch(
              b,
              { chat, broadcaster, ownChannel: options?.ownChannel?.() },
              "grpc",
            );
            store.ingestion.ingest(batch.messages, {
              key,
              value: batch.cursor,
            });
            status("subscribed:grpc");
            failures = 0;
            if (batch.ended) {
              status("ended");
              return "end";
            }
            return "continue";
          },
        );
        if (completion === "end") return;
        await sleep(1000, undefined, { signal });
      }
    } catch (e: any) {
      if (signal.aborted) break;
      const state =
        e instanceof UpstreamError
          ? e.state
          : e.code === 16
            ? "auth_required"
            : e.code === 7
              ? "permission_blocked"
              : e.code === 8
                ? "quota_blocked"
                : e.code === 3 && token
                  ? "invalid_cursor"
                  : "reconnecting";
      status(
        state,
        e instanceof UpstreamError
          ? e.api
          : "YouTube liveChatMessages.streamList",
      );
      if (
        [
          "auth_required",
          "permission_blocked",
          "quota_blocked",
          "ended",
        ].includes(state)
      )
        return;
      if (state === "invalid_cursor") {
        store.db
          .prepare("DELETE FROM connector_checkpoints WHERE key=?")
          .run(key);
      } else if (
        transport === "grpc" &&
        config.restFallback &&
        [12, 14].includes(e.code) &&
        ++failures >= 3
      ) {
        transport = "rest";
        status("fallback_to_rest");
        store.audit("youtube.grpc_to_rest");
      } else failures++;
      await sleep(
        Math.max(
          e.retryMs ?? 0,
          Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
        ) *
          (1 + Math.random() * 0.2),
        undefined,
        { signal },
      ).catch(() => {});
    }
  }
  status("stopped");
}
