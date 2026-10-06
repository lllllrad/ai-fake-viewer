import {
  YoutubeReadApi,
  UpstreamError,
} from "./infrastructure/platforms/youtube-read-api.ts";
export {
  googleJson,
  UpstreamError,
  videoId,
} from "./infrastructure/platforms/youtube-read-api.ts";
import { receiveYoutubeStream } from "./infrastructure/platforms/youtube-grpc.ts";
export { makeGrpcClient } from "./infrastructure/platforms/youtube-grpc.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { youtubeChatBatch } from "./infrastructure/platforms/youtube-chat-payload.ts";
export {
  normalizeYoutube,
  ignoreYoutubeOwnMessage,
} from "./infrastructure/platforms/youtube-chat-payload.ts";
import type { Store } from "./storage.ts";
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
  const api = new YoutubeReadApi(options?.access);
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
      selectedVideo = (await api.search(channelId, signal)) ?? "";
      if (signal.aborted) {
        status("stopped");
        return;
      }
      if (!selectedVideo) {
        status("waiting_live");
        return;
      }
    }
    const resolved = await api.video(
      selectedVideo,
      !!store.participation,
      signal,
    );
    if (signal.aborted) {
      status("stopped");
      return;
    }
    chat = resolved.chat ?? "";
    if (store.participation) {
      broadcaster = resolved.broadcaster;
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
        const b = await api.messages(chat, token, signal);
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
        Math.min(
          2147483647,
          Math.max(
            e.retryMs ?? 0,
            Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
          ) *
            (1 + Math.random() * 0.2),
        ),
        undefined,
        { signal },
      ).catch(() => {});
    }
  }
  status("stopped");
}
