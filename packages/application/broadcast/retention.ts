export interface RetentionInput {
  sessionId: string;
  before: number;
  now: number;
  auditBefore: number;
  resultBefore: number;
}
export interface RetentionRepository {
  purge(input: RetentionInput): boolean;
  compact(): void;
}
export class BroadcastRetention {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly transactions: {
      run<T>(work: () => T): T;
      afterCommit(effect: () => void): void;
    },
    private readonly environment: {
      sessionId(): string;
      live(): boolean;
      closed(): boolean;
      now(): number;
      refreshSummary(): void;
      reset(): void;
    },
  ) {}
  purge(before: number) {
    if (!Number.isFinite(before)) throw new Error("Invalid retention cutoff");
    // Live broadcasts keep their history until an explicit end, regardless of age.
    if (this.environment.live() && !this.environment.closed()) return false;
    const now = this.environment.now();
    return this.transactions.run(() => {
      const changed = this.repository.purge({
        sessionId: this.environment.sessionId(),
        before,
        now,
        auditBefore: now - 90 * 86400000,
        resultBefore: now - 86400000,
      });
      if (!changed) return false;
      if (!this.environment.closed()) this.environment.refreshSummary();
      this.transactions.afterCommit(() => this.repository.compact());
      this.transactions.afterCommit(() => this.environment.reset());
      return true;
    });
  }
}
