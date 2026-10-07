import type { Incoming } from "../../contracts/incoming.ts";
export interface YoutubeReceiverConfig {
  video: string;
  channelId?: string;
  transport: "grpc" | "rest";
  restFallback: boolean;
}
export interface YoutubeBatch {
  messages: Incoming[];
  cursor: string;
  ended: boolean;
  pollIntervalMs: number;
}
export interface YoutubeReceiverPorts {
  broadcastId: string;
  configured: boolean;
  current(): boolean;
  requiresParticipation: boolean;
  available(broadcaster: string): boolean;
  resolve(chat: string, broadcaster: string): void;
  status(state: string, api?: string): void;
  search(channel: string, signal: AbortSignal): Promise<string | undefined>;
  video(
    video: string,
    signal: AbortSignal,
  ): Promise<{ chat?: string; broadcaster?: string }>;
  messages(
    chat: string,
    cursor: string | undefined,
    broadcaster: string | undefined,
    signal: AbortSignal,
  ): Promise<YoutubeBatch>;
  stream(
    chat: string,
    cursor: string | undefined,
    broadcaster: string | undefined,
    signal: AbortSignal,
    receive: (batch: YoutubeBatch) => "continue" | "end",
  ): Promise<"closed" | "end">;
  checkpoint(key: string): string | undefined;
  clearCheckpoint(key: string): void;
  ingest(
    messages: Incoming[],
    checkpoint: { key: string; value: string },
  ): void;
  fallback(): void;
  issue(
    error: unknown,
    phase: "discovery" | "rest" | "grpc",
    hasCursor: boolean,
  ): { state: string; api?: string; retryMs: number; canFallback: boolean };
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  random(): number;
}

/** Broadcast-bound discovery, reception, cursor recovery and transport fallback. */
export async function receiveYoutube(
  config: YoutubeReceiverConfig,
  ports: YoutubeReceiverPorts,
  signal: AbortSignal,
) {
  const current = () => !signal.aborted && ports.current();
  const status = (state: string, api?: string) => {
    if (ports.current()) ports.status(state, api);
  };
  if (!current()) {
    status("stopped");
    return;
  }
  if (!ports.configured) {
    status("config_required");
    return;
  }
  let chat = "";
  let broadcaster: string | undefined;
  let selectedVideo = config.video.trim();
  while (current()) {
    try {
      if (!selectedVideo && config.channelId?.trim()) {
        const channel = config.channelId.trim();
        if (!/^UC[\w-]{22}$/.test(channel)) {
          status("config_required");
          return;
        }
        selectedVideo = (await ports.search(channel, signal)) ?? "";
        if (!current()) {
          status("stopped");
          return;
        }
        if (!selectedVideo) {
          status("waiting_live");
          await ports.sleep(30000, signal);
          continue;
        }
      }
      const resolved = await ports.video(selectedVideo, signal);
      if (!current()) {
        status("stopped");
        return;
      }
      chat = resolved.chat ?? "";
      if (ports.requiresParticipation) {
        broadcaster = resolved.broadcaster;
        if (!broadcaster || !ports.available(broadcaster)) {
          status("privacy_blocked");
          return;
        }
      }
      if (chat && broadcaster) ports.resolve(chat, broadcaster);
      if (!current()) return;
      if (!chat) {
        status("waiting_live");
        await ports.sleep(30000, signal);
        selectedVideo = config.video.trim();
        continue;
      }
      break;
    } catch (error) {
      if (!current()) {
        status("stopped");
        return;
      }
      const issue = ports.issue(error, "discovery", false);
      status(issue.state, issue.api);
      return;
    }
  }
  if (!current()) return;
  let transport = config.transport,
    failures = 0;
  status("connecting");
  while (current()) {
    if (failures) status("reconnecting");
    const key = `youtube:${ports.broadcastId}:${chat}:${transport}`;
    const cursor = ports.checkpoint(key);
    try {
      const apply = (batch: YoutubeBatch): "continue" | "end" => {
        if (!current()) return "end";
        ports.ingest(batch.messages, { key, value: batch.cursor });
        if (!current()) return "end";
        status(`subscribed:${transport}`);
        failures = 0;
        if (batch.ended) {
          status("ended");
          return "end";
        }
        return "continue";
      };
      if (transport === "rest") {
        const batch = await ports.messages(chat, cursor, broadcaster, signal);
        if (!current()) break;
        if (apply(batch) === "end") return;
        await ports.sleep(batch.pollIntervalMs, signal);
      } else {
        const completion = await ports.stream(
          chat,
          cursor,
          broadcaster,
          signal,
          apply,
        );
        if (completion === "end") return;
        if (!current()) break;
        await ports.sleep(1000, signal);
      }
    } catch (error) {
      if (!current()) break;
      const issue = ports.issue(error, transport, !!cursor);
      status(issue.state, issue.api);
      if (!current()) break;
      if (
        [
          "auth_required",
          "permission_blocked",
          "quota_blocked",
          "ended",
        ].includes(issue.state)
      )
        return;
      if (issue.state === "invalid_cursor") ports.clearCheckpoint(key);
      else {
        failures++;
        if (
          transport === "grpc" &&
          config.restFallback &&
          issue.canFallback &&
          failures >= 3
        ) {
          transport = "rest";
          status("fallback_to_rest");
          if (!current()) break;
          ports.fallback();
        }
      }
      await ports
        .sleep(
          Math.min(
            2147483647,
            Math.max(
              issue.retryMs,
              Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
            ) *
              (1 + ports.random() * 0.2),
          ),
          signal,
        )
        .catch(() => {});
    }
  }
  status("stopped");
}
