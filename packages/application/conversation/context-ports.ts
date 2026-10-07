import type { MessageDependency } from "../../domain/conversation/dependencies.ts";
export interface ContextRepository {
  dependencies(session: string): MessageDependency[];
  hasMessage(session: string, id: string, visibleOnly: boolean): boolean;
  eraseMessage(session: string, id: string, now: number): number;
  pruneIdentities(session: string): void;
  clearAttemptContext(session: string): void;
  cancelPendingAttempts(session: string, now: number): void;
  recordDependencies(messageId: string, sourceIds: string[]): void;
  audit(session: string, action: "message.hidden", now: number): void;
}
export interface ContextEnvironment {
  sessionId(): string;
  now(): number;
  refreshIdentityNames(): void;
  publishRemoval(sequences: number[]): void;
  invalidate(): void;
}
export interface ContextTransactions {
  run<T>(work: () => T): T;
  afterCommit(effect: () => void): void;
}
