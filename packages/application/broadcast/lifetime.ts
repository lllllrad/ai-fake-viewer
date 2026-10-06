export interface BroadcastLifetimeRepository {
  erase(): void;
  create(id: string, at: number, closed: boolean): void;
  closeReference(id: string, at: number): number;
  compact(): void;
}
export interface BroadcastLifetimeTransactions {
  run<T>(work: () => T): T;
  afterCommit(effect: () => void): void;
}
export interface BroadcastLifetimeEnvironment {
  sessionId(): string;
  closed(): boolean;
  live(): boolean;
  id(): string;
  now(): number;
  replace(id: string, at: number, closed: boolean, erase: boolean): void;
  reset(): void;
  closedEvent(sequence: number): void;
}

/** Owns durable broadcast boundaries, including memory rollback through the transaction port. */
export class BroadcastLifetime {
  constructor(
    private readonly repository: BroadcastLifetimeRepository,
    private readonly transactions: BroadcastLifetimeTransactions,
    private readonly environment: BroadcastLifetimeEnvironment,
  ) {}
  end() {
    if (this.environment.closed()) return;
    if (this.environment.live()) return this.erase(true);
    this.transactions.run(() => {
      const sequence = this.repository.closeReference(
        this.environment.sessionId(),
        this.environment.now(),
      );
      this.transactions.afterCommit(() =>
        this.environment.closedEvent(sequence),
      );
    });
  }
  createNext() {
    if (this.environment.live()) return this.erase(false);
    this.transactions.run(() => {
      this.end();
      this.replace(false, false);
      this.transactions.afterCommit(() => this.environment.reset());
    });
  }
  erase(closed = false) {
    this.transactions.run(() => {
      this.repository.erase();
      this.replace(closed, true);
      this.transactions.afterCommit(() => this.repository.compact());
      this.transactions.afterCommit(() => this.environment.reset());
    });
  }
  private replace(closed: boolean, erase: boolean) {
    const id = this.environment.id(),
      at = this.environment.now();
    this.repository.create(id, at, closed);
    this.environment.replace(id, at, closed, erase);
  }
}
