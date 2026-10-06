import { fixedNoticeText } from "./domain/participation/notice-text.ts";
import type { ApiFailure } from "./api-health.ts";
import { ChzzkNoticeTransport } from "./infrastructure/platforms/chzzk-notice-transport.ts";
import { randomUUID } from "node:crypto";
import { FixedNoticeDelivery } from "./application/participation/fixed-notice-delivery.ts";
import type { ParticipationService as Participation } from "./application/participation/service.ts";
import type { ChzzkAuth } from "./chzzk.ts";
export class ChzzkNotices {
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
  private readonly transport: ChzzkNoticeTransport;
  constructor(
    private participation: Participation,
    private auth: ChzzkAuth,
    request: typeof fetch = fetch,
  ) {
    this.transport = new ChzzkNoticeTransport(auth, request);
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
    if (!this.auth.token) {
      this.state = "auth_required";
      return;
    }
    this.busy = true;
    try {
      let bot = this.bots.get(target.broadcaster);
      if (!bot) {
        bot = new FixedNoticeDelivery(
          this.participation,
          target.broadcaster,
          "chzzk",
          { now: () => Date.now(), id: randomUUID },
        );
        this.bots.set(target.broadcaster, bot);
      }
      if (this.job && !bot.valid(this.job.id)) {
        bot.failed(this.job.id);
        this.job = undefined;
      }
      if (!this.job) {
        const next = bot.next(true);
        if (!next) {
          this.state = bot.state;
          return;
        }
        let message: string;
        try {
          message = fixedNoticeText(next.text, 88);
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
      const result = await this.transport.send(
        { broadcaster: target.broadcaster, text: job.message },
        signal,
        {
          valid: () =>
            this.connected &&
            this.target === target &&
            this.job === job &&
            bot!.valid(job.id),
          sending: () => {
            this.state = "sending";
          },
        },
      );
      // Transport completion and application continuation are separate cancellation boundaries.
      if (this.target !== target || this.job !== job) return;
      if (result.status === "stale" || !result.current()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      if (result.status === "rejected") {
        this.state = result.state;
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
        e instanceof Error &&
        [
          "notice_too_long",
          "auth_required",
          "permission_or_quota_blocked",
          "permission_blocked",
          "quota_blocked",
          "channel_mismatch",
        ].includes(e.message)
          ? e.message
          : "delivery_unconfirmed";
      this.blockedUntil =
        Date.now() +
        ([
          "auth_required",
          "permission_or_quota_blocked",
          "permission_blocked",
          "quota_blocked",
          "channel_mismatch",
        ].includes(this.state)
          ? 300000
          : 60000);
    } finally {
      this.busy = false;
    }
  }
}
