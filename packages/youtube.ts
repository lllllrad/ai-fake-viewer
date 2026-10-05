import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { setTimeout as sleep } from "node:timers/promises";
import type { Incoming } from "./contracts.ts";
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
export function normalizeYoutube(item: any, chat: string): Incoming | null {
  const s = item.snippet ?? {},
    a = item.authorDetails ?? item.author_details ?? {};
  const type = s.type;
  if (!["textMessageEvent", "TEXT_MESSAGE_EVENT", 1].includes(type))
    return null;
  const text =
    s.displayMessage ??
    s.display_message ??
    s.textMessageDetails?.messageText ??
    s.text_message_details?.message_text;
  if (typeof text !== "string" || !text || !item.id) return null;
  const stamp = Date.parse(s.publishedAt ?? s.published_at);
  return {
    platform: "youtube",
    channel: chat,
    sourceId: item.id,
    author:
      a.channelId ??
      a.channel_id ??
      s.authorChannelId ??
      s.author_channel_id ??
      `unknown-${item.id}`,
    name: a.displayName ?? a.display_name ?? "YouTube viewer",
    text,
    publishedAt: Number.isFinite(stamp) ? stamp : null,
  };
}
export class UpstreamError extends Error {
  constructor(
    public state: string,
    public retryMs = 0,
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
            : r.status === 403
              ? String(reason).includes("quota")
                ? "quota_blocked"
                : "permission_blocked"
              : "reconnecting";
    throw new UpstreamError(
      state,
      Number(r.headers.get("retry-after") ?? 0) * 1000,
    );
  }
  return b;
}
export function makeGrpcClient() {
  const defs = loadSync(
    fileURLToPath(
      new URL("../vendor/youtube/stream_list.proto", import.meta.url),
    ),
    {
      keepCase: true,
      enums: String,
      longs: String,
      defaults: false,
      oneofs: true,
    },
  );
  const pkg = grpc.loadPackageDefinition(defs) as any;
  return new pkg.youtube.api.v3.V3DataLiveChatMessageService(
    "youtube.googleapis.com:443",
    grpc.credentials.createSsl(),
    { "grpc.max_receive_message_length": 4 * 1024 * 1024 },
  );
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
  status: (s: string) => void,
  options?: {
    access?: () => Promise<string>;
    resolve?: (chat: string, broadcaster: string) => void;
    ownChannel?: () => string | undefined;
  },
) {
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
    status(e instanceof UpstreamError ? e.state : "config_required");
    return;
  }
  let transport = config.transport;
  let failures = 0;
  while (!signal.aborted) {
    status(failures ? "reconnecting" : "connecting");
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
        store.ingestBatch(
          (b.items ?? [])
            .map((i: any) => {
              const m = normalizeYoutube(i, chat);
              if (m && m.author === options?.ownChannel?.()) return null;
              return m && broadcaster ? { ...m, channel: broadcaster } : m;
            })
            .filter(Boolean),
          { key, value: b.nextPageToken ?? "" },
        );
        status("subscribed:rest");
        failures = 0;
        if (b.offlineAt) {
          status("ended");
          return;
        }
        await sleep(
          Math.max(1000, Number(b.pollingIntervalMillis) || 5000),
          undefined,
          { signal },
        );
      } else {
        const client = makeGrpcClient();
        const metadata = new grpc.Metadata();
        if (options?.access)
          metadata.set("authorization", `Bearer ${await options.access()}`);
        else if (process.env.YOUTUBE_ACCESS_TOKEN)
          metadata.set(
            "authorization",
            `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}`,
          );
        else metadata.set("x-goog-api-key", process.env.YOUTUBE_API_KEY!);
        const stream = client.StreamList(
          {
            live_chat_id: chat,
            part: ["id", "snippet", "authorDetails"],
            ...(token ? { page_token: token } : {}),
          },
          metadata,
        );
        const abort = () => stream.cancel();
        signal.addEventListener("abort", abort, { once: true });
        try {
          for await (const b of stream) {
            if (signal.aborted) break;
            if (signal.aborted) break;
            store.ingestBatch(
              (b.items ?? [])
                .map((i: any) => {
                  const m = normalizeYoutube(i, chat);
                  if (m && m.author === options?.ownChannel?.()) return null;
                  return m && broadcaster ? { ...m, channel: broadcaster } : m;
                })
                .filter(Boolean),
              { key, value: b.next_page_token ?? "" },
            );
            status("subscribed:grpc");
            failures = 0;
            if (b.offline_at) {
              status("ended");
              return;
            }
          }
        } finally {
          signal.removeEventListener("abort", abort);
          stream.cancel();
          client.close();
        }
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
      status(state);
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
