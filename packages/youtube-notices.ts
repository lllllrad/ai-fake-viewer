import { fixedNoticeText } from "./domain/participation/notice-text.ts";
import type { ApiFailure } from "./api-health.ts";
import { YoutubeNoticeTransport } from "./infrastructure/platforms/youtube-notice-transport.ts";
import { randomUUID } from "node:crypto";
import { FixedNoticeDelivery } from "./application/participation/fixed-notice-delivery.ts";
import type { ParticipationService as Participation } from "./application/participation/service.ts";
import type { YoutubeAuth } from "./youtube-auth.ts";
export class YoutubeNotices {
  state = "waiting_connection";
  failure?: ApiFailure;
  private target?: { chat: string; broadcaster: string };
  private bots = new Map<string, FixedNoticeDelivery>();
  private job?: {
    bot: FixedNoticeDelivery;
    id: string;
    text: string;
    message: string;
  };
  private blockedUntil = 0;
  private busy = false;
  connected = false;
  private readonly transport: YoutubeNoticeTransport;
  constructor(
    private participation: Participation,
    private auth: YoutubeAuth,
    request: typeof fetch = fetch,
  ) {
    this.transport = new YoutubeNoticeTransport(auth, request);
  }
  resolve(chat: string, broadcaster: string) {
    this.reset();
    this.target = { chat, broadcaster };
  }
  reset() {
    this.failure = undefined;
    this.target = undefined;
    this.connected = false;
    this.job = undefined;
    for (const bot of this.bots.values()) bot.reset();
    this.state = "waiting_connection";
  }
  async tick(signal: AbortSignal) {
    if (this.busy || signal.aborted || Date.now() < this.blockedUntil) return;
    const target = this.target;
    if (!this.connected || !target) {
      this.state = "waiting_connection";
      return;
    }
    if (!this.auth.connected) {
      this.state = "auth_required";
      return;
    }
    if (this.auth.channelId !== target.broadcaster) {
      this.state = "channel_mismatch";
      return;
    }
    this.busy = true;
    try {
      let bot = this.bots.get(target.broadcaster);
      if (!bot) {
        bot = new FixedNoticeDelivery(
          this.participation,
          target.broadcaster,
          "youtube",
          { now: () => Date.now(), id: randomUUID },
        );
        this.bots.set(target.broadcaster, bot);
      }
      if (this.job && !bot.valid(this.job.id)) {
        bot.failed(this.job.id);
        this.job = undefined;
      }
      let first = false;
      if (!this.job) {
        const next = bot.next(true);
        if (!next) {
          this.state = bot.state;
          return;
        }
        first = true;
        let message: string;
        try {
          message = fixedNoticeText(next.text);
        } catch (error) {
          bot.failed(next.id);
          throw error;
        }
        this.job = {
          ...next,
          bot,
          message,
        };
      }
      const job = this.job;
      if (!first && !bot.reserveAttempt(job.id)) return;
      const result = await this.transport.send(
        { ...target, text: job.message },
        signal,
        {
          valid: () =>
            this.target === target && this.job === job && bot!.valid(job.id),
          connected: () => this.connected,
          sending: () => {
            this.state = "sending";
          },
        },
      );
      // The application may reset while a settled transport result is queued.
      if (this.target !== target || this.job !== job) return;
      if (
        result.status === "stale" ||
        signal.aborted ||
        !this.auth.connected ||
        this.auth.channelId !== target.broadcaster ||
        !bot.valid(job.id)
      ) {
        bot.failed(job.id);
        if (this.job === job) this.job = undefined;
        return;
      }
      if (result.status === "waiting_connection") {
        this.state = "waiting_connection";
        return;
      }
      if (result.status === "rejected") {
        this.state = result.failure.state;
        this.failure = result.failure;
        this.blockedUntil = Date.now() + result.retryAfterMs;
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      this.failure = undefined;
      bot.echo(target.broadcaster, job.text);
      this.job = undefined;
      this.state = bot.state;
    } catch (e) {
      this.job?.bot.failed(this.job.id);
      this.job = undefined;
      this.state =
        e instanceof Error && e.message === "notice_too_long"
          ? "notice_too_long"
          : "delivery_unconfirmed";
      this.blockedUntil = Date.now() + 60000;
    } finally {
      this.busy = false;
    }
  }
}
