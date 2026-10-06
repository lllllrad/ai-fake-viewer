import type { ChatSummary } from "../../domain/conversation/summary.ts";
import type { MessageDependency } from "../../domain/conversation/dependencies.ts";
export interface SummaryRow {
  actor: string;
  text: string;
}
export interface ContextRepository {
  summary(session: string): { payload: unknown; cutoff: number } | undefined;
  saveSummary(
    session: string,
    value: ChatSummary,
    expires: number,
    cutoff: number,
  ): void;
  consentedRows(session: string, since: number, cutoff: number): SummaryRow[];
  dependencies(session: string): MessageDependency[];
  hasMessage(session: string, id: string, visibleOnly: boolean): boolean;
  participantMessages(
    session: string,
    platform: string,
    channel: string,
    author: string,
  ): string[];
  eraseMessage(session: string, id: string, now: number): number;
  pruneIdentities(session: string): void;
  clearAttemptContext(session: string): void;
  cancelPendingAttempts(session: string, now: number): void;
  recordDependencies(messageId: string, sourceIds: string[]): void;
  audit(
    session: string,
    action: "message.hidden" | "chat_summary.cleared",
    now: number,
  ): void;
}
export interface ContextEnvironment {
  sessionId(): string;
  liveParticipation(): boolean;
  now(): number;
  lastSequence(): number;
  permittedRows(now: number, cutoff: number): SummaryRow[];
  refreshIdentityNames(): void;
  publishRemoval(sequences: number[]): void;
  invalidate(): void;
}
export interface ContextTransactions {
  run<T>(work: () => T): T;
  afterCommit(effect: () => void): void;
}
