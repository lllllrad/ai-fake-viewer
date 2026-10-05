import { fork, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { Store } from "./storage.ts";
import type { Config } from "./config.ts";
import { incomingSchema } from "./contracts.ts";
import { runYoutube } from "./youtube.ts";
import { ChzzkAuth, normalizeChzzk } from "./chzzk.ts";
import { workerEnv } from "./capture.ts";
export class Supervisor {
  states: Record<
    string,
    {
      state: string;
      recoveries: number;
      received: number;
      lastReceived: number | null;
    }
  > = {};
  controllers = new Map<string, AbortController>();
  children = new Set<ChildProcess>();
  tasks = new Set<Promise<void>>();
  demoTimer?: NodeJS.Timeout;
  constructor(
    public config: Config,
    public store: Store,
    public auth: ChzzkAuth,
    public demo = false,
  ) {
    for (const p of ["youtube", "chzzk", "soop"])
      this.states[p] = {
        state: "disabled",
        recoveries: 0,
        received: 0,
        lastReceived: null,
      };
    store.on("event", (e: any) => {
      const p = e.payload?.attribution;
      if (
        this.states[p] &&
        e.type.startsWith("message.") &&
        e.type !== "message.hidden"
      ) {
        this.states[p].received++;
        this.states[p].lastReceived = Date.now();
      }
    });
  }
  status(p: string, s: string) {
    if (p === "youtube" && s === "reconnecting" && this.states[p].state !== s)
      this.states[p].recoveries++;
    this.states[p].state = s;
  }
  receive(p: string, m: unknown) {
    try {
      const parsed = incomingSchema.parse(m);
      if (this.store.closed()) return;
      this.store.ingestBatch([parsed]);
    } catch {
      this.status(p, "invalid_event_rejected");
    }
  }
  start() {
    if (this.demo) {
      if (this.demoTimer) return;
      for (const p of Object.keys(this.states)) this.status(p, "demo_fixture");
      let n = 0;
      const tick = () => {
        const p = ["youtube", "chzzk", "soop"][n % 3];
        this.receive(p, {
          platform: p,
          channel: "demo-channel",
          author: `demo-${n % 4}`,
          name: `Demo viewer ${(n % 4) + 1}`,
          text: [
            "[DEMO] 안녕하세요!",
            "[DEMO] 화면 색이 바뀌었네요 🎨",
            "[DEMO] 인공 채팅 데이터입니다.",
          ][n % 3],
          sourceId: `fixture-${Date.now()}-${n++}`,
        });
      };
      tick();
      this.demoTimer = setInterval(tick, 4000);
      return;
    }
    if (this.config.youtube.enabled)
      this.launch("youtube", (signal) =>
        runYoutube(this.config.youtube, this.store, signal, (s) =>
          this.status("youtube", s),
        ),
      );
    if (this.config.chzzk.enabled)
      this.launch("chzzk", (signal) => this.chzzk(signal));
    if (this.config.soop.mode === "official")
      this.status(
        "soop",
        this.config.soop.streamerId ? "awaiting_browser" : "config_required",
      );
    else if (this.config.soop.mode === "experimental_library") {
      if (!this.config.soop.experimentalConsent)
        this.status("soop", "needs_approval");
      else if (!this.config.soop.streamerId)
        this.status("soop", "config_required");
      else this.launch("soop", (signal) => this.soop(signal));
    }
  }
  launch(p: string, fn: (signal: AbortSignal) => Promise<void>) {
    if (this.controllers.has(p)) return;
    const c = new AbortController();
    this.controllers.set(p, c);
    const task = fn(c.signal)
      .catch(() => {
        if (!c.signal.aborted) this.status(p, "failed");
      })
      .finally(() => {
        if (this.controllers.get(p) === c) this.controllers.delete(p);
        this.tasks.delete(task);
      });
    this.tasks.add(task);
  }
  worker(name: string) {
    const child = fork(new URL(`../workers/${name}.cjs`, import.meta.url), [], {
      execArgv: [],
      env: workerEnv(),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.children.add(child);
    child.once("exit", () => this.children.delete(child));
    return child;
  }
  async chzzk(signal: AbortSignal) {
    let attempts = 0;
    while (!signal.aborted) {
      let child: ChildProcess | undefined,
        key: string | undefined,
        terminal = false;
      const abort = () => child?.kill();
      signal.addEventListener("abort", abort, { once: true });
      try {
        this.status("chzzk", "connecting");
        await this.auth.access();
        const session = await this.auth.api("/open/v1/sessions/auth");
        if (signal.aborted) return;
        if (typeof session.url !== "string" || session.url.length > 4096)
          throw Error("permission_blocked");
        const url = new URL(session.url);
        if (
          url.protocol !== "https:" ||
          !url.hostname.endsWith(".nchat.naver.com") ||
          url.username ||
          url.password
        )
          throw Error("permission_blocked");
        child = this.worker("chzzk");
        let subscribed = false;
        let subscribedChannel: string | undefined;
        const timeout = setTimeout(() => child?.kill(), 15000);
        await new Promise<void>((resolve, reject) => {
          child!.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
          child!.once("error", () => reject(Error("reconnecting")));
          child!.on("message", (m: any) => {
            void (async () => {
              if (signal.aborted) return;
              if (m.type === "SYSTEM") {
                const e =
                  typeof m.data === "string" ? JSON.parse(m.data) : m.data;
                if (
                  e.type === "connected" &&
                  typeof e.data?.sessionKey === "string"
                ) {
                  key = e.data.sessionKey;
                  await this.auth.api(
                    `/open/v1/sessions/events/subscribe/chat?${new URLSearchParams({ sessionKey: key! })}`,
                    "POST",
                  );
                } else if (
                  e.type === "subscribed" &&
                  e.data?.eventType === "CHAT"
                ) {
                  if (typeof e.data.channelId !== "string" || !e.data.channelId)
                    throw Error("invalid_subscription");
                  subscribedChannel = e.data.channelId;
                  subscribed = true;
                  clearTimeout(timeout);
                  this.status("chzzk", "subscribed");
                  attempts = 0;
                } else if (["revoked", "unsubscribed"].includes(e.type)) {
                  terminal = true;
                  this.status("chzzk", "permission_blocked");
                  child?.kill();
                }
              } else if (m.type === "CHAT" && subscribed) {
                const parsed = normalizeChzzk(m.data);
                if (parsed.channel !== subscribedChannel) return;
                this.receive("chzzk", parsed);
              }
            })().catch(() => {
              terminal = true;
              this.status("chzzk", "permission_blocked");
              child?.kill();
            });
          });
          child!.send({ type: "connect", url: session.url });
        });
      } catch (e: any) {
        const state = ["auth_required", "permission_blocked"].includes(
          e.message,
        )
          ? e.message
          : "reconnecting";
        this.status("chzzk", state);
        terminal = state !== "reconnecting";
      } finally {
        signal.removeEventListener("abort", abort);
        child?.kill();
        if (key)
          await this.auth
            .api(
              `/open/v1/sessions/events/unsubscribe/chat?${new URLSearchParams({ sessionKey: key })}`,
              "POST",
            )
            .catch(() => {});
      }
      if (terminal || signal.aborted) return;
      this.states.chzzk.recoveries++;
      this.status("chzzk", "reconnecting");
      await sleep(
        Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) *
          (1 + Math.random() * 0.2),
        undefined,
        { signal },
      ).catch(() => {});
    }
  }
  async soop(signal: AbortSignal) {
    let attempts = 0;
    while (!signal.aborted) {
      this.status("soop", "connecting:unofficial");
      const child = this.worker("soop");
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => child.kill(), 20000);
      await new Promise<void>((resolve) => {
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.once("error", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.on("message", (m: any) => {
          if (signal.aborted) return;
          if (m.type === "ready") {
            clearTimeout(timeout);
            this.status("soop", "subscribed:unofficial");
            attempts = 0;
          } else if (m.type === "CHAT") this.receive("soop", m.data);
        });
        child.send({
          type: "connect",
          streamerId: this.config.soop.streamerId,
        });
      });
      signal.removeEventListener("abort", abort);
      child.kill();
      if (signal.aborted) break;
      this.states.soop.recoveries++;
      if (++attempts >= 6) {
        this.status("soop", "failed:check_broadcast_and_library");
        return;
      }
      this.status("soop", "reconnecting:unofficial");
      await sleep(Math.min(30000, 1000 * 2 ** attempts), undefined, {
        signal,
      }).catch(() => {});
    }
  }
  async stop() {
    clearInterval(this.demoTimer);
    this.demoTimer = undefined;
    for (const c of this.controllers.values()) c.abort();
    for (const child of this.children) child.kill();
    await Promise.allSettled([...this.tasks]);
    for (const p of Object.keys(this.states)) this.status(p, "stopped");
  }
}
