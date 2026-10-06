import { startDemoChat } from "../reference/demo-chat.ts";
import { PlatformTasks } from "../../application/inputs/platform-tasks.ts";
import { NoticeDeliverySession } from "../../application/participation/notice-delivery-session.ts";
import {
  ChzzkNotices,
  YoutubeNotices,
} from "../participation/platform-notices.ts";
import { runChzzkReceiver } from "../platforms/chzzk-receiver.ts";
import { YoutubeAuth } from "../accounts/youtube-auth.ts";
import { fork, type ChildProcess } from "node:child_process";
import type { Store } from "../../storage.ts";
import type { Config } from "../../config.ts";
import { incomingSchema } from "../../contracts.ts";
import { runYoutube } from "../platforms/youtube-receiver.ts";
import { ChzzkAuth } from "../accounts/chzzk-auth.ts";
import { workerEnv } from "../../capture.ts";
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
    if (this.platformTasks.stopping || this.store.closed()) return;
    if (this.demo) {
      if (this.demoTimer) return;
      this.demoTimer = startDemoChat({
        status: (platform, state) => this.status(platform, state),
        grantConsent: (platform, channel, author) =>
          this.store.grantConsent(platform, channel, author),
        receive: (platform, message) => this.receive(platform, message),
      });
      return;
    }
    const allowed = (platform: string) => {
      if (!this.store.participation) return true;
      const available = this.config.privacy.approvals.some(
        (approval) =>
          approval.platform === platform &&
          this.store.participation!.available(platform, approval.broadcaster),
      );
      if (!available) this.status(platform, "privacy_blocked");
      return available;
    };
    if (this.config.youtube.enabled && allowed("youtube"))
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
    if (this.config.chzzk.enabled && allowed("chzzk"))
      this.launch("chzzk", (signal) =>
        this.withNotices("chzzk", signal, () => this.chzzk(signal)),
      );
    if (this.config.soop.mode === "official" && allowed("soop")) {
      if (!["connecting", "subscribed"].includes(this.states.soop.state))
        this.status(
          "soop",
          this.config.soop.streamerId ? "awaiting_browser" : "config_required",
        );
    } else if (
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
    const child = fork(
      new URL(`../../../workers/${name}.cjs`, import.meta.url),
      [],
      {
        execArgv: [],
        env: workerEnv(),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    this.children.add(child);
    child.once("exit", () => this.children.delete(child));
    return child;
  }
  chzzk(signal: AbortSignal) {
    return runChzzkReceiver(this.store, this.auth, signal, {
      worker: () => this.worker("chzzk"),
      notices: this.chzzkNotices,
      status: (state, api) => {
        this.status("chzzk", state);
        this.states.chzzk.api = api;
      },
      recovered: () => {
        this.states.chzzk.recoveries++;
      },
    });
  }
  async soop(signal: AbortSignal) {
    const { runReferenceSoop } = await import("../reference/soop-receiver.ts");
    return runReferenceSoop(this.config.soop.streamerId, signal, {
      worker: () => this.worker("soop"),
      status: (state) => this.status("soop", state),
      receive: (message) => this.receive("soop", message),
      recovered: () => {
        this.states.soop.recoveries++;
      },
    });
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
