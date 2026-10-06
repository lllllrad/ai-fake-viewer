import { z } from "zod";
import { limitState, type ApiFailure } from "../../api-health.ts";

export interface ChzzkNoticeAccount {
  readonly token?: object;
  access(): Promise<string>;
}
type Outcome =
  | { status: "delivered" | "stale" }
  | {
      status: "rejected";
      state: string;
      retryAfterMs: number;
      failure?: ApiFailure;
    };
export type ChzzkNoticeResult = Outcome & { current(): boolean };
const identitySchema = z.object({
  code: z.literal(200),
  content: z.object({ channelId: z.string() }),
});
const receiptSchema = z.object({
  code: z.literal(200),
  content: z.object({ messageId: z.string().min(1) }),
});
const errorSchema = z.object({
  error: z
    .object({
      errors: z.array(z.object({ reason: z.string().optional() })).optional(),
    })
    .optional(),
});
const blocked = (state: string) =>
  [
    "auth_required",
    "permission_or_quota_blocked",
    "permission_blocked",
    "quota_blocked",
    "channel_mismatch",
  ].includes(state);

/** CHZZK identity lookup and fixed notice insertion, bound to refreshed credentials. */
export class ChzzkNoticeTransport {
  constructor(
    private readonly account: ChzzkNoticeAccount,
    private readonly request: typeof fetch = fetch,
  ) {}
  async send(
    notice: { broadcaster: string; text: string },
    signal: AbortSignal,
    eligibility: { valid(): boolean; sending(): void },
  ): Promise<ChzzkNoticeResult> {
    let credentials = this.account.token;
    const current = () =>
      !signal.aborted &&
      !!credentials &&
      this.account.token === credentials &&
      eligibility.valid();
    const result = (outcome: Outcome): ChzzkNoticeResult => ({
      ...outcome,
      current,
    });
    try {
      if (!current()) return result({ status: "stale" });
      const token = await this.account.access();
      credentials = this.account.token;
      if (!current()) return result({ status: "stale" });
      const identity = await this.request(
        "https://openapi.chzzk.naver.com/open/v1/users/me",
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!current()) return result({ status: "stale" });
      if (!identity.ok) {
        const state = limitState(identity.status);
        return result({
          status: "rejected",
          state,
          retryAfterMs: blocked(state) ? 300000 : 60000,
          failure: {
            api: "CHZZK User API / users/me",
            operation: "identity",
            state,
          },
        });
      }
      const user = identitySchema.safeParse(await identity.json());
      if (!current()) return result({ status: "stale" });
      if (!user.success || user.data.content.channelId !== notice.broadcaster)
        throw Error("channel_mismatch");
      eligibility.sending();
      const response = await this.request(
        "https://openapi.chzzk.naver.com/open/v1/chats/send",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: notice.text }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!current()) return result({ status: "stale" });
      const body: unknown = await response.json().catch(() => undefined);
      if (!current()) return result({ status: "stale" });
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        const reason = parsed.success
          ? (parsed.data.error?.errors?.[0]?.reason ?? "")
          : "";
        const state = limitState(response.status, reason);
        return result({
          status: "rejected",
          state,
          retryAfterMs:
            response.status === 401 || response.status === 403 ? 300000 : 60000,
          failure: {
            api: "CHZZK Chat API / chats/send",
            operation: "send",
            state,
          },
        });
      }
      if (!receiptSchema.safeParse(body).success)
        throw Error("delivery_unconfirmed");
      return result({ status: "delivered" });
    } catch (error) {
      if (!current()) return result({ status: "stale" });
      const state =
        error instanceof Error && blocked(error.message)
          ? error.message
          : "delivery_unconfirmed";
      return result({
        status: "rejected",
        state,
        retryAfterMs: blocked(state) ? 300000 : 60000,
      });
    }
  }
}
