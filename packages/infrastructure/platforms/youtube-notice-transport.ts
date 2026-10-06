import { z } from "zod";
import { limitState, type ApiFailure } from "../../api-health.ts";

export interface YoutubeNoticeAccount {
  readonly connected: boolean;
  readonly channelId: string | undefined;
  access(): Promise<string>;
}
export type NoticeInsertResult =
  | { status: "delivered" | "stale" | "waiting_connection" }
  | { status: "rejected"; failure: ApiFailure; retryAfterMs: number };

const receiptSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    liveChatId: z.string(),
    authorChannelId: z.string(),
    textMessageDetails: z.object({ messageText: z.string() }),
  }),
});
const errorSchema = z.object({
  error: z
    .object({
      errors: z.array(z.object({ reason: z.string().optional() })).optional(),
    })
    .optional(),
});

/** Transport for the application's fixed notice; receipt reconnects do not revoke successful writes. */
export class YoutubeNoticeTransport {
  constructor(
    private readonly account: YoutubeNoticeAccount,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(
    notice: { chat: string; broadcaster: string; text: string },
    signal: AbortSignal,
    eligibility: { valid(): boolean; connected(): boolean; sending(): void },
  ): Promise<NoticeInsertResult> {
    const valid = () =>
      !signal.aborted &&
      this.account.connected &&
      this.account.channelId === notice.broadcaster &&
      eligibility.valid();
    try {
      if (!valid()) return { status: "stale" };
      const token = await this.account.access();
      if (!valid()) return { status: "stale" };
      if (!eligibility.connected()) return { status: "waiting_connection" };
      eligibility.sending();
      const response = await this.request(
        "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            snippet: {
              liveChatId: notice.chat,
              type: "textMessageEvent",
              textMessageDetails: { messageText: notice.text },
            },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!valid()) return { status: "stale" };
      const body: unknown = await response.json().catch(() => undefined);
      if (!valid()) return { status: "stale" };
      if (!response.ok) {
        const error = errorSchema.safeParse(body);
        const reason = error.success
          ? (error.data.error?.errors?.[0]?.reason ?? "")
          : "";
        return {
          status: "rejected",
          failure: {
            api: "YouTube liveChatMessages.insert",
            operation: "send",
            state: limitState(response.status, reason),
          },
          retryAfterMs:
            response.status === 401 || response.status === 403 ? 300000 : 60000,
        };
      }
      const receipt = receiptSchema.safeParse(body);
      if (
        !receipt.success ||
        receipt.data.snippet.liveChatId !== notice.chat ||
        receipt.data.snippet.authorChannelId !== notice.broadcaster ||
        receipt.data.snippet.textMessageDetails.messageText !== notice.text
      )
        throw Error("delivery_unconfirmed");
      return { status: "delivered" };
    } catch {
      if (!valid()) return { status: "stale" };
      // Provider bodies and token refresh errors must not escape into UI diagnostics.
      throw Error("delivery_unconfirmed");
    }
  }
}
