import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { join } from "node:path";
import {
  displayChatSettingsSchema,
  type DisplayChatSettings,
  type DisplayChat,
  type DisplayChatStatus,
} from "../../contracts/display-chat.ts";
import { PlatformTasks } from "../../application/inputs/platform-tasks.ts";
import {
  PlatformAccounts,
  type AccountPlatform,
} from "../../application/accounts/platform-accounts.ts";
import { YoutubeAuth } from "../accounts/youtube-auth.ts";
import { ChzzkAuth } from "../accounts/chzzk-auth.ts";
import { SoopAuth } from "../accounts/soop-auth.ts";
import { runYoutube } from "./youtube-receiver.ts";
import { runChzzk } from "./chzzk-connection.ts";
import { workerEnv } from "../inputs/worker-session.ts";

/** Receive-only adapters. No AI store, model, prompts, summary or notice sender. */
export class DisplayChatConnections {
  settings: DisplayChatSettings;
  readonly accounts: PlatformAccounts;
  readonly youtube: YoutubeAuth;
  readonly chzzk: ChzzkAuth;
  readonly soop: SoopAuth;
  private readonly states = Object.fromEntries(
    ["youtube", "chzzk", "soop"].map((p) => [
      p,
      {
        state: "stopped",
        received: 0,
        lastReceived: null as number | null,
      },
    ]),
  ) as Record<
    AccountPlatform,
    { state: string; received: number; lastReceived: number | null }
  >;
  private readonly tasks = new PlatformTasks(
    (p) => this.state(p as AccountPlatform, "failed"),
    (p) => this.state(p as AccountPlatform, "stopped"),
  );
  private soopEpoch = randomUUID();
  private soopSeen = 0;
  private changing = false;
  private disposed = false;
  constructor(
    settings: DisplayChatSettings,
    key: string,
    private readonly ports: {
      session(): string;
      closed(): boolean;
      receive(message: DisplayChat): boolean;
      port: number;
      demo: boolean;
      directory?: string;
      persist?: (settings: DisplayChatSettings) => void;
    },
  ) {
    this.settings = displayChatSettingsSchema.parse(settings);
    const directory =
      ports.directory ?? join(".local", "ephemeral-display-" + randomUUID());
    this.youtube = new YoutubeAuth(key, join(directory, "youtube.tokens"));
    this.chzzk = new ChzzkAuth(key, join(directory, "chzzk.tokens"));
    this.soop = new SoopAuth(key, join(directory, "soop.tokens"));
    this.accounts = new PlatformAccounts({
      settings: () => ({
        demo: ports.demo,
        youtube: {
          enabled: this.settings.youtube.enabled,
          configured: this.youtube.configured,
          redirectUri: this.redirect("youtube"),
        },
        chzzk: {
          enabled: this.settings.chzzk.enabled,
          configured: !!(
            process.env.CHZZK_CLIENT_ID && process.env.CHZZK_CLIENT_SECRET
          ),
          redirectUri: this.redirect("chzzk"),
        },
        soop: {
          enabled: this.settings.soop.enabled,
          clientId: process.env.SOOP_CLIENT_ID,
          clientSecret: process.env.SOOP_CLIENT_SECRET,
          redirectUri: this.redirect("soop"),
        },
      }),
      youtube: this.youtube,
      chzzk: {
        authorizationUrl: (uri) => this.chzzk.authorizationUrl(uri),
        cancel: (state) => {
          this.chzzk.states.delete(state);
        },
        exchange: (code, state) => this.chzzk.exchange(code, state),
        forget: () => this.chzzk.forget(),
      },
      soop: this.soop,
      stop: (p) => this.stop(p),
      soopStatus: (s) => this.state("soop", s),
      now: Date.now,
    });
  }
  private redirect(platform: string) {
    return `http://127.0.0.1:${this.ports.port}/oauth/${platform}/callback`;
  }
  private state(platform: AccountPlatform, state: string) {
    if (this.states[platform]) this.states[platform].state = state;
  }
  status(): DisplayChatStatus {
    if (
      this.states.soop.state === "subscribed" &&
      Date.now() - this.soopSeen > 30000
    )
      this.state("soop", "disconnected");
    const connected = {
      youtube: this.youtube.connected,
      chzzk: !!this.chzzk.token,
      soop: !!this.soop.token,
    };
    const credentials = {
      youtube: this.youtube.configured || !!process.env.YOUTUBE_API_KEY,
      chzzk: !!(process.env.CHZZK_CLIENT_ID && process.env.CHZZK_CLIENT_SECRET),
      soop: !!(process.env.SOOP_CLIENT_ID && process.env.SOOP_CLIENT_SECRET),
    };
    return {
      settings: this.settings,
      closed: this.ports.closed(),
      platforms: Object.fromEntries(
        (["youtube", "chzzk", "soop"] as const).map((p) => [
          p,
          {
            ...this.states[p],
            state: this.settings[p].enabled
              ? this[p].storageError
                ? "auth_failed"
                : this.states[p].state
              : "disabled",
            connected: connected[p],
            credentialsConfigured: credentials[p],
          },
        ]),
      ) as DisplayChatStatus["platforms"],
    };
  }
  private receive(message: DisplayChat) {
    if (
      this.ports.closed() ||
      this.disposed ||
      !this.settings[message.platform].enabled
    )
      return;
    if (this.ports.receive(message)) {
      this.states[message.platform].received++;
      this.states[message.platform].lastReceived = Date.now();
    }
  }
  start(platform: AccountPlatform) {
    if (
      this.disposed ||
      this.changing ||
      this.tasks.stopping ||
      this.ports.closed() ||
      this.ports.demo ||
      !this.settings[platform].enabled
    )
      return;
    const session = this.ports.session();
    const current = () =>
      !this.disposed &&
      !this.ports.closed() &&
      this.ports.session() === session;
    if (platform === "youtube")
      this.tasks.start(platform, (signal) =>
        runYoutube(
          this.settings.youtube,
          signal,
          (s) => {
            if (current() && !signal.aborted) this.state(platform, s);
          },
          {
            broadcastId: session,
            current,
            receive: (messages) => {
              if (current() && !signal.aborted)
                for (const m of messages) this.receive(m);
            },
            access: this.youtube.connected
              ? () => this.youtube.access()
              : undefined,
            ownChannel: () => this.youtube.channelId,
          },
        ),
      );
    if (platform === "chzzk")
      this.tasks.start(platform, (signal) =>
        runChzzk(
          {
            account: this.chzzk,
            worker: () =>
              fork(new URL("../../../workers/chzzk.cjs", import.meta.url), [], {
                execArgv: [],
                env: workerEnv(),
                stdio: ["ignore", "ignore", "ignore", "ipc"],
              }),
            available: () => current() && !signal.aborted,
            subscribed: () => {},
            reset: () => {},
            recovered: () => {},
            receive: (message) => {
              if (current() && !signal.aborted) this.receive(message);
            },
            status: (s) => {
              if (current() && !signal.aborted) this.state(platform, s);
            },
          },
          signal,
        ),
      );
    if (platform === "soop") this.state(platform, "awaiting_browser");
  }
  startAll() {
    for (const p of ["youtube", "chzzk", "soop"] as const) this.start(p);
  }
  async stop(platform: AccountPlatform) {
    if (platform === "soop") {
      this.soopEpoch = randomUUID();
      this.soopSeen = 0;
    }
    await this.tasks.stop(platform);
  }
  async stopAll() {
    this.soopEpoch = randomUUID();
    this.soopSeen = 0;
    await this.tasks.stopAll(() => {
      for (const p of ["youtube", "chzzk", "soop"] as const)
        this.state(p, "stopped");
    });
  }
  async save(raw: unknown) {
    if (this.changing || this.disposed)
      throw Error("Chat settings update in progress");
    const next = displayChatSettingsSchema.parse(raw);
    this.changing = true;
    try {
      this.ports.persist?.(next);
      await this.stopAll();
      if (this.disposed) return;
      this.settings = next;
    } finally {
      this.changing = false;
    }
    this.startAll();
  }
  private assertSoop(epoch?: string) {
    if (
      this.disposed ||
      this.changing ||
      this.ports.closed() ||
      this.ports.demo ||
      !this.settings.soop.enabled ||
      !this.settings.soop.streamerId ||
      (epoch !== undefined && epoch !== this.soopEpoch)
    )
      throw Error("SOOP connection changed; reconnect from the chat panel");
  }
  async soopSession() {
    this.assertSoop();
    const epoch = this.soopEpoch,
      session = this.ports.session();
    if (!process.env.SOOP_CLIENT_ID || !process.env.SOOP_CLIENT_SECRET)
      throw Error("SOOP app credentials are missing");
    const accessToken = await this.soop.access(
      process.env.SOOP_CLIENT_ID,
      process.env.SOOP_CLIENT_SECRET,
    );
    this.assertSoop(epoch);
    if (session !== this.ports.session()) throw Error("Broadcast changed");
    this.soopEpoch = randomUUID();
    this.soopSeen = Date.now();
    this.state("soop", "connecting");
    return {
      broadcastId: this.soopEpoch,
      clientId: process.env.SOOP_CLIENT_ID,
      accessToken,
      streamerId: this.settings.soop.streamerId,
    };
  }
  soopStatus(state: string, epoch: string) {
    this.assertSoop(epoch);
    this.soopSeen = Date.now();
    this.state("soop", state);
  }
  soopMessage(input: {
    broadcastId: string;
    userId: string;
    userNickname: string;
    message: string;
    sourceId: string;
  }) {
    this.assertSoop(input.broadcastId);
    if (this.status().platforms.soop.state !== "subscribed")
      throw Error("SOOP chat is not connected");
    this.receive({
      platform: "soop",
      channel: this.settings.soop.streamerId,
      sourceId: input.sourceId,
      author: input.userId,
      name: input.userNickname,
      text: input.message,
    });
  }
  async close() {
    this.disposed = true;
    await this.stopAll();
  }
}
