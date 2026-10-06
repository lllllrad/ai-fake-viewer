import type { ApiFailure } from "../../contracts/api-failure.ts";
export interface NoticeTarget {
  chat: string;
  broadcaster: string;
}
export type NoticeSendResult = (
  | { status: "delivered" | "stale" | "waiting_connection" }
  | {
      status: "rejected";
      state?: string;
      failure?: ApiFailure;
      retryAfterMs: number;
    }
) & { current?(): boolean };
export interface NoticeTransport {
  availability(
    target: NoticeTarget,
  ): "ready" | "auth_required" | "channel_mismatch";
  send(
    notice: NoticeTarget & { text: string },
    signal: AbortSignal,
    eligibility: { valid(): boolean; connected(): boolean; sending(): void },
  ): Promise<NoticeSendResult>;
}
