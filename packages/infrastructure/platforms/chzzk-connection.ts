import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { ApiQuotaError } from "../../api-health.ts";
import { normalizeChzzk } from "./chzzk-chat-payload.ts";
import type { Incoming } from "../../contracts/incoming.ts";

export interface ChzzkConnectionPorts {
  account: {
    access(): Promise<string>;
    api(path: string, method?: string): Promise<unknown>;
  };
  worker(): ChildProcess;
  available(channel: string): boolean;
  subscribed(channel: string): void;
  receive(message: Incoming): void;
  status(state: string, api?: string): void;
  recovered(): void;
  reset(): void;
  retry?(delay: number, signal: AbortSignal): Promise<void>;
}

const sessionSchema = z.object({ url: z.string().max(4096) });
const envelopeSchema = z.object({ type: z.string(), data: z.unknown() });
const systemSchema = z.object({
  type: z.string(),
  data: z.unknown().optional(),
});
const systemDataSchema = z.object({
  sessionKey: z.string().optional(),
  eventType: z.string().optional(),
  channelId: z.string().optional(),
});

/** Own one worker's callbacks, timeout and subscription; no broadcast storage. */
async function connect(ports: ChzzkConnectionPorts, signal: AbortSignal) {
  let child: ChildProcess | undefined;
  let key: string | undefined;
  let active = true;
  let terminal = false;
  let subscribed = false;
  let channel: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cleanup = () => {};
  const current = () => active && !signal.aborted;
  const kill = () => {
    active = false;
    child?.kill();
  };
  signal.addEventListener("abort", kill, { once: true });
  try {
    if (!current()) return { terminal, subscribed };
    ports.status("connecting");
    await ports.account.access();
    if (!current()) return { terminal, subscribed };
    const raw = await ports.account.api("/open/v1/sessions/auth");
    if (!current()) return { terminal, subscribed };
    const result = sessionSchema.safeParse(raw);
    if (!result.success) throw Error("permission_blocked");
    const session = result.data;
    const url = new URL(session.url);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".nchat.naver.com") ||
      url.username ||
      url.password
    )
      throw Error("permission_blocked");
    child = ports.worker();
    timeout = setTimeout(kill, 15000);
    await new Promise<void>((resolve, reject) => {
      const exit = () => {
        active = false;
        resolve();
      };
      const error = () => {
        active = false;
        reject(Error("reconnecting"));
      };
      const message = (raw: unknown) => {
        void (async () => {
          if (!current()) return;
          const m = envelopeSchema.parse(raw);
          if (m.type === "SYSTEM") {
            const e = systemSchema.parse(
              typeof m.data === "string" ? JSON.parse(m.data) : m.data,
            );
            const data = ["connected", "subscribed"].includes(e.type)
              ? systemDataSchema.parse(e.data ?? {})
              : undefined;
            if (e.type === "connected" && data?.sessionKey) {
              // A repeated connected event must not issue a second subscription.
              if (key) return;
              key = data.sessionKey;
              await ports.account.api(
                `/open/v1/sessions/events/subscribe/chat?${new URLSearchParams({ sessionKey: key })}`,
                "POST",
              );
            } else if (e.type === "subscribed" && data?.eventType === "CHAT") {
              if (!data.channelId || !ports.available(data.channelId))
                throw Error("permission_blocked");
              channel = data.channelId;
              ports.subscribed(channel);
              subscribed = true;
              clearTimeout(timeout);
              ports.status("subscribed");
            } else if (["revoked", "unsubscribed"].includes(e.type)) {
              terminal = true;
              ports.status("permission_blocked");
              kill();
            }
          } else if (m.type === "CHAT" && subscribed) {
            const parsed = normalizeChzzk(m.data);
            if (parsed.channel === channel) ports.receive(parsed);
          }
        })().catch((error: unknown) => {
          // A request may settle after exit, abort or a newer connection starts.
          if (!current()) return;
          terminal = true;
          ports.status(
            error instanceof ApiQuotaError
              ? "quota_blocked"
              : "permission_blocked",
            error instanceof ApiQuotaError ? error.api : undefined,
          );
          kill();
        });
      };
      cleanup = () => {
        child!.removeListener("exit", exit);
        child!.removeListener("error", error);
        child!.removeListener("message", message);
      };
      child!.once("exit", exit);
      child!.once("error", error);
      child!.on("message", message);
      child!.send({ type: "connect", url: session.url });
    });
  } catch (error: unknown) {
    if (!signal.aborted) {
      const message = error instanceof Error ? error.message : "";
      const state = [
        "auth_required",
        "permission_blocked",
        "quota_blocked",
      ].includes(message)
        ? message
        : "reconnecting";
      ports.status(
        state,
        error instanceof ApiQuotaError ? error.api : undefined,
      );
      terminal = state !== "reconnecting";
    }
  } finally {
    active = false;
    clearTimeout(timeout);
    cleanup();
    signal.removeEventListener("abort", kill);
    child?.kill();
    ports.reset();
    if (key)
      await ports.account
        .api(
          `/open/v1/sessions/events/unsubscribe/chat?${new URLSearchParams({ sessionKey: key })}`,
          "POST",
        )
        .catch(() => {});
  }
  return { terminal, subscribed };
}

export async function runChzzk(
  ports: ChzzkConnectionPorts,
  signal: AbortSignal,
) {
  let attempts = 0;
  while (!signal.aborted) {
    const result = await connect(ports, signal);
    if (result.terminal || signal.aborted) return;
    if (result.subscribed) attempts = 0;
    ports.recovered();
    ports.status("reconnecting");
    const delay =
      Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) *
      (1 + Math.random() * 0.2);
    if (ports.retry) await ports.retry(delay, signal);
    else await sleep(delay, undefined, { signal }).catch(() => {});
  }
}
