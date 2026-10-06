import { limitState, type ApiFailure } from "./api-health.ts";
import { NoticeBot } from "./notice-bot.ts";
import type { ParticipationService as Participation } from "./application/participation/service.ts";
import type { ChzzkAuth } from "./chzzk.ts";
import { noticeParts } from "./youtube-notices.ts";
export class ChzzkNotices {
  state = "waiting_connection";
  failure?: ApiFailure;
  private target?: { chat: string; broadcaster: string };
  private bots = new Map<string, NoticeBot>();
  private job?: {
    bot: NoticeBot;
    id: string;
    text: string;
    parts: string[];
    index: number;
    target: { chat: string; broadcaster: string };
  };
  private blockedUntil = 0;
  private busy = false;
  connected = false;
  constructor(
    private participation: Participation,
    private auth: ChzzkAuth,
    private request: typeof fetch = fetch,
  ) {}
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
        bot = new NoticeBot(this.participation, target.broadcaster, "chzzk");
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
        let parts: string[];
        try {
          parts = noticeParts(next.text, 88);
          if (parts.length !== 1) throw Error("notice_too_long");
        } catch (error) {
          bot.failed(next.id);
          throw error;
        }
        this.job = {
          ...next,
          bot,
          parts,
          index: 0,
          target,
        };
      }
      const job = this.job;
      if (!first && !bot.reservePart(job.id)) return;
      const token = await this.auth.access();
      const credentials = this.auth.token;
      // OAuth refresh is asynchronous: recheck consent/session/target immediately before sending.
      const valid = () =>
        !signal.aborted &&
        this.connected &&
        this.target === target &&
        this.job === job &&
        !!credentials &&
        this.auth.token === credentials &&
        bot!.valid(job.id);
      if (!valid()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      const identity = await this.request(
        "https://openapi.chzzk.naver.com/open/v1/users/me",
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!identity.ok) {
        const state = limitState(identity.status);
        this.failure = {
          api: "CHZZK User API / users/me",
          operation: "identity",
          state,
        };
        throw Error(state);
      }
      const user = (await identity.json()) as any;
      if (user.code !== 200 || user.content?.channelId !== target.broadcaster)
        throw Error("channel_mismatch");
      if (!valid()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      const text = job.parts[job.index];
      this.state = "sending";
      const r = await this.request(
        "https://openapi.chzzk.naver.com/open/v1/chats/send",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: text }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!valid()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      if (!r.ok) {
        const errorBody = (await r.json().catch(() => ({}))) as any;
        this.state = limitState(
          r.status,
          String(errorBody.error?.errors?.[0]?.reason ?? ""),
        );
        this.failure = {
          api: "CHZZK Chat API / chats/send",
          operation: "send",
          state: this.state,
        };
        // No immediate retry of ambiguous writes; count failures against the same limits.
        this.blockedUntil =
          Date.now() + (r.status === 401 || r.status === 403 ? 300000 : 60000);
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      const b = (await r.json()) as any;
      if (!valid()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      if (
        b.code !== 200 ||
        typeof b.content?.messageId !== "string" ||
        !b.content.messageId
      )
        throw Error("delivery_unconfirmed");
      this.failure = undefined;
      if (++job.index === job.parts.length) {
        bot.echo(target.broadcaster, job.text);
        this.job = undefined;
        this.state = bot.state;
      } else this.state = "sending";
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
