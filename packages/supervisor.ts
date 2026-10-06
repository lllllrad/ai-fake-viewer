import { PlatformTasks } from "./application/inputs/platform-tasks.ts";
import { NoticeDeliverySession } from "./application/participation/notice-delivery-session.ts";
import {
  ChzzkNotices,
  YoutubeNotices,
} from "./infrastructure/participation/platform-notices.ts";
import { runChzzk } from "./infrastructure/platforms/chzzk-connection.ts";
import { YoutubeAuth } from "./youtube-auth.ts";
import { fork, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { Store } from "./storage.ts";
import type { Config } from "./config.ts";
import { incomingSchema } from "./contracts.ts";
import { runYoutube } from "./youtube.ts";
import { ChzzkAuth } from "./chzzk.ts";
import { workerEnv } from "./capture.ts";
export class Supervisor {
  youtubeNotices?: YoutubeNotices;
  chzzkNotices?: ChzzkNotices;
  private readonly platformTasks = new PlatformTasks(
    (platform) => {
      if (this.states[platform]) this.status(platform, "failed");
    },
    (platform) => this.status(platform, "stopped"),
  );
  onBroadcastEnded?: () => void;
  states: Record<
    string,
    {
      state: string;
      api?: string;
      recoveries: number;
      received: number;
      lastReceived: number | null;
    }
  > = {};
  children = new Set<ChildProcess>();
  demoTimer?: NodeJS.Timeout;
  constructor(
    public config: Config,
    public store: Store,
    public auth: ChzzkAuth,
    public demo = false,
    public youtubeAuth?: YoutubeAuth,
  ) {
    if (!demo && store.participation) {
      this.chzzkNotices = new ChzzkNotices(store.participation, auth, fetch);
      store.on("reset", () => this.chzzkNotices?.reset());
    }
    if (!demo && store.participation && youtubeAuth) {
      this.youtubeNotices = new YoutubeNotices(
        store.participation,
        youtubeAuth,
        fetch,
      );
      store.on("reset", () => this.youtubeNotices?.reset());
    }
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
    const previous = this.states[p]?.state;
    if (p === "chzzk" && this.chzzkNotices)
      this.chzzkNotices.connected = s === "subscribed";
    if (p === "youtube" && this.youtubeNotices)
      this.youtubeNotices.connected = s.startsWith("subscribed:");
    if (p === "youtube" && s === "reconnecting" && this.states[p].state !== s)
      this.states[p].recoveries++;
    if (
      this.store.participation &&
      ["reconnecting", "disconnected", "failed"].includes(s)
    ) {
      this.store.participation.connectionLost(p);
    }
    this.states[p].state = s;
    if (s === "ended" && previous !== "ended") this.onBroadcastEnded?.();
  }
  receive(p: string, m: unknown) {
    try {
      const parsed = incomingSchema.parse(m);
      if (this.store.closed()) return;
      this.store.ingestion.ingest([parsed]);
    } catch {
      this.status(p, "invalid_event_rejected");
    }
  }
  start() {
    if (this.platformTasks.stopping) return;
    if (this.demo) {
      if (this.demoTimer) return;
      for (const p of Object.keys(this.states)) this.status(p, "demo_fixture");
      let n = 0;
      const tick = () => {
        const p = ["youtube", "chzzk", "soop"][n % 3];
        const author = `demo-${n % 4}`;
        this.store.grantConsent(p, "demo-channel", author);
        this.receive(p, {
          platform: p,
          channel: "demo-channel",
          author,
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
    if (this.store.participation) {
      for (const platform of ["youtube", "chzzk", "soop"]) {
        if (
          !this.config.privacy.approvals.some(
            (a) =>
              a.platform === platform &&
              this.store.participation!.available(platform, a.broadcaster),
          )
        )
          this.status(platform, "privacy_blocked");
      }
    }
    if (
      this.config.youtube.enabled &&
      (!this.store.participation ||
        this.states.youtube.state !== "privacy_blocked")
    )
      this.launch("youtube", (signal) =>
        this.withNotices("youtube", signal, () =>
          runYoutube(
            this.config.youtube,
            this.store,
            signal,
            (s, api) => {
              this.status("youtube", s);
              this.states.youtube.api = api;
            },
            {
              access: this.youtubeAuth?.connected
                ? () => this.youtubeAuth!.access()
                : undefined,
              resolve: (chat, broadcaster) =>
                this.youtubeNotices?.resolve(chat, broadcaster),
              ownChannel: () => this.youtubeAuth?.channelId,
            },
          ),
        ),
      );
    if (
      this.config.chzzk.enabled &&
      (!this.store.participation ||
        this.states.chzzk.state !== "privacy_blocked")
    )
      this.launch("chzzk", (signal) =>
        this.withNotices("chzzk", signal, () => this.chzzk(signal)),
      );
    if (
      this.config.soop.mode === "official" &&
      (!this.store.participation ||
        this.states.soop.state !== "privacy_blocked")
    )
      this.status(
        "soop",
        this.config.soop.streamerId ? "awaiting_browser" : "config_required",
      );
    else if (
      this.config.soop.mode === "experimental_library" &&
      !this.store.participation
    ) {
      if (!this.config.soop.experimentalConsent)
        this.status("soop", "needs_approval");
      else if (!this.config.soop.streamerId)
        this.status("soop", "config_required");
      else this.launch("soop", (signal) => this.soop(signal));
    }
  }
  private async withNotices(
    platform: "youtube" | "chzzk",
    signal: AbortSignal,
    receive: () => Promise<void>,
  ) {
    const sender =
      platform === "youtube" ? this.youtubeNotices : this.chzzkNotices;
    const delivery =
      sender &&
      new NoticeDeliverySession(
        sender,
        signal,
        {
          repeat: (callback, milliseconds) =>
            setInterval(callback, milliseconds),
          cancel: (handle: ReturnType<typeof setInterval>) =>
            clearInterval(handle),
        },
        () => {
          sender.state = "delivery_unconfirmed";
        },
      );
    try {
      await receive();
    } finally {
      await delivery?.stop();
    }
  }
  launch(p: string, fn: (signal: AbortSignal) => Promise<void>) {
    return this.platformTasks.start(p, fn);
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
    await runChzzk(
      {
        account: this.auth,
        worker: () => this.worker("chzzk"),
        available: (channel) =>
          !this.store.participation ||
          this.store.participation.available("chzzk", channel),
        subscribed: (channel) => this.chzzkNotices?.resolve(channel, channel),
        receive: (message) => this.receive("chzzk", message),
        status: (state, api) => {
          this.status("chzzk", state);
          this.states.chzzk.api = api;
        },
        recovered: () => {
          this.states.chzzk.recoveries++;
        },
        reset: () => this.chzzkNotices?.reset(),
      },
      signal,
    );
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
  stopPlatform(p: string) {
    return this.platformTasks.stop(p);
  }
  async stop() {
    clearInterval(this.demoTimer);
    this.demoTimer = undefined;
    const drain = this.platformTasks.stopAll(() => {
      for (const p of Object.keys(this.states)) this.status(p, "stopped");
    });
    for (const child of this.children) child.kill();
    await drain;
  }
}
