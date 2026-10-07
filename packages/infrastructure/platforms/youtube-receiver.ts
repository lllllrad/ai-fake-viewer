import { setTimeout as sleep } from "node:timers/promises";
import {
  receiveYoutube,
  type YoutubeReceiverConfig,
  type YoutubeReceiverPorts,
} from "../../application/inputs/youtube-receiver.ts";
import type { DisplayChat } from "../../contracts/display-chat.ts";
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
  signal: AbortSignal,
  status: (state: string, api?: string) => void,
  options: {
    broadcastId: string;
    current(): boolean;
    receive(messages: DisplayChat[]): void;
    access?: () => Promise<string>;
    ownChannel?: () => string | undefined;
  },
) {
  const api = new YoutubeReadApi(options.access);
  const checkpoints = new Map<string, string>();
  return receiveYoutube(
    config,
    {
      broadcastId: options.broadcastId,
      configured: !!(
        options.access ||
        process.env.YOUTUBE_API_KEY ||
        process.env.YOUTUBE_ACCESS_TOKEN
      ),
      current: options.current,
      status,
      search: (channel, signal) =>
        options.access && options.ownChannel?.() === channel
          ? api.activeBroadcast(channel, signal)
          : api.search(channel, signal),
      video: (video, signal) => api.video(video, false, signal),
      messages: async (chat, cursor, broadcaster, signal) =>
        youtubeChatBatch(
          await api.messages(chat, cursor, signal),
          { chat, broadcaster },
          "rest",
        ),
      stream: (chat, cursor, broadcaster, signal, receive) =>
        receiveYoutubeStream(
          { chat, cursor, access: options.access },
          signal,
          (raw) =>
            receive(youtubeChatBatch(raw, { chat, broadcaster }, "grpc")),
        ),
      checkpoint: (key) => checkpoints.get(key),
      clearCheckpoint: (key) => {
        checkpoints.delete(key);
      },
      ingest: (messages, checkpoint) => {
        if (!options.current() || signal.aborted) return;
        options.receive(messages);
        checkpoints.set(checkpoint.key, checkpoint.value);
      },
      fallback: () => {},
      issue: youtubeReceiveIssue,
      sleep: (milliseconds, signal) =>
        sleep(milliseconds, undefined, { signal }),
      random: Math.random,
    },
    signal,
  );
}
