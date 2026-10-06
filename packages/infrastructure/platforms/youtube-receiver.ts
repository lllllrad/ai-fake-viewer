import { withBroadcastInput } from "../inputs/broadcast-input.ts";
import { setTimeout as sleep } from "node:timers/promises";
import {
  receiveYoutube,
  type YoutubeReceiverConfig,
  type YoutubeReceiverPorts,
} from "../../application/inputs/youtube-receiver.ts";
import type { Store } from "../../storage.ts";
import { YoutubeReadApi, UpstreamError } from "./youtube-read-api.ts";
import { youtubeChatBatch } from "./youtube-chat-payload.ts";
import { receiveYoutubeStream } from "./youtube-grpc.ts";

export const youtubeReceiveIssue: YoutubeReceiverPorts["issue"] = (
  error,
  phase,
  hasCursor,
) => {
  if (error instanceof UpstreamError)
    return {
      state: error.state,
      api: error.api,
      retryMs: error.retryMs,
      canFallback: false,
    };
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const state =
    phase === "discovery"
      ? "config_required"
      : code === 16
        ? "auth_required"
        : code === 7
          ? "permission_blocked"
          : code === 8
            ? "quota_blocked"
            : code === 3 && hasCursor
              ? "invalid_cursor"
              : "reconnecting";
  return {
    state,
    api:
      phase === "discovery"
        ? undefined
        : phase === "rest"
          ? "YouTube liveChatMessages.list"
          : "YouTube liveChatMessages.streamList",
    retryMs: 0,
    canFallback: code === 12 || code === 14,
  };
};
export function runYoutube(
  config: YoutubeReceiverConfig,
  store: Store,
  signal: AbortSignal,
  status: (state: string, api?: string) => void,
  options?: {
    access?: () => Promise<string>;
    resolve?: (chat: string, broadcaster: string) => void;
    ownChannel?: () => string | undefined;
  },
) {
  const api = new YoutubeReadApi(options?.access);
  return withBroadcastInput(store, signal, (scope) =>
    receiveYoutube(
      config,
      {
        broadcastId: scope.broadcastId,
        configured: !!(
          options?.access ||
          process.env.YOUTUBE_API_KEY ||
          process.env.YOUTUBE_ACCESS_TOKEN
        ),
        current: scope.current,
        requiresParticipation: !!store.participation,
        available: (broadcaster) =>
          !!store.participation?.available("youtube", broadcaster),
        resolve: (chat, broadcaster) => options?.resolve?.(chat, broadcaster),
        status,
        search: (channel, signal) => api.search(channel, signal),
        video: (video, signal) =>
          api.video(video, !!store.participation, signal),
        messages: async (chat, cursor, broadcaster, signal) =>
          youtubeChatBatch(
            await api.messages(chat, cursor, signal),
            { chat, broadcaster, ownChannel: options?.ownChannel?.() },
            "rest",
          ),
        stream: (chat, cursor, broadcaster, signal, receive) =>
          receiveYoutubeStream(
            { chat, cursor, access: options?.access },
            signal,
            (raw) =>
              receive(
                youtubeChatBatch(
                  raw,
                  { chat, broadcaster, ownChannel: options?.ownChannel?.() },
                  "grpc",
                ),
              ),
          ),
        checkpoint: (key) => store.checkpoints.get(key),
        clearCheckpoint: (key) => store.checkpoints.clear(key),
        ingest: (messages, checkpoint) => {
          store.ingestion.ingest(messages, checkpoint);
        },
        fallback: () => store.audit("youtube.grpc_to_rest"),
        issue: youtubeReceiveIssue,
        sleep: (milliseconds, signal) =>
          sleep(milliseconds, undefined, { signal }),
        random: Math.random,
      },
      scope.signal,
    ),
  );
}
