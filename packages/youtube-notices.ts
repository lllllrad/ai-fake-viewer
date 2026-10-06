import { limitState, type ApiFailure } from "./api-health.ts";
import { NoticeBot } from "./notice-bot.ts";
import type { ParticipationService as Participation } from "./application/participation/service.ts";
import type { YoutubeAuth } from "./youtube-auth.ts";
// Conservative local 200-character message cap. Never truncate a notice or a URL.
export function noticeParts(text: string, budget = 170) {
  const chunks: string[] = [];
  let chunk = "";
  for (const word of text.split(/\s+/u)) {
    if (word.length > budget) throw Error("notice_too_long");
    if (chunk && chunk.length + word.length + 1 > budget) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += (chunk ? " " : "") + word;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((s, i) => `[안내 ${i + 1}/${chunks.length}] ${s}`);
}
export class YoutubeNotices {
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
    private auth: YoutubeAuth,
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
        bot = new NoticeBot(this.participation, target.broadcaster, "youtube");
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
          parts = noticeParts(next.text);
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
      // OAuth refresh is asynchronous: recheck consent/session/target immediately before sending.
      const valid = () =>
        !signal.aborted &&
        this.target === target &&
        this.job === job &&
        this.auth.channelId === target.broadcaster &&
        bot!.valid(job.id);
      if (!valid()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      // Connectivity gates new writes, not acknowledgements of completed writes.
      // A receive rollover during refresh must not discard already confirmed parts.
      if (!this.connected) {
        this.state = "waiting_connection";
        return;
      }
      const text = job.parts[job.index];
      this.state = "sending";
      const r = await this.request(
        "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            snippet: {
              liveChatId: target.chat,
              type: "textMessageEvent",
              textMessageDetails: { messageText: text },
            },
          }),
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
          api: "YouTube liveChatMessages.insert",
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
      // The exact successful resource proves delivery even if receipt is reconnecting.
      // Session, target, consent, authentication and cancellation still have to match.
      const b = (await r.json()) as any;
      if (!valid()) {
        bot.failed(job.id);
        this.job = undefined;
        return;
      }
      if (
        !b.id ||
        b.snippet?.liveChatId !== target.chat ||
        b.snippet?.authorChannelId !== target.broadcaster ||
        b.snippet?.textMessageDetails?.messageText !== text
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
        e instanceof Error && e.message === "notice_too_long"
          ? "notice_too_long"
          : "delivery_unconfirmed";
      this.blockedUntil = Date.now() + 60000;
    } finally {
      this.busy = false;
    }
  }
}
