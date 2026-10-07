import {
  incomingSchema,
  type Incoming,
  type ValidatedIncoming,
} from "../../contracts/incoming.ts";
export interface IncomingRepository {
  write(message: ValidatedIncoming): number | undefined;
  checkpoint(key: string, value: string): void;
}
export class ConversationIngestion {
  constructor(
    private readonly repository: IncomingRepository,
    private readonly transactions: {
      run<T>(work: () => T): T;
      afterCommit(effect: () => void): void;
    },
    private readonly environment: {
      closed(): boolean;
      refreshCollisions(): boolean;
      invalidate(): void;
      publish(sequence: number): void;
      reset(): void;
    },
  ) {}
  ingest(
    items: Incoming[],
    checkpoint?: { key: string; value: string },
  ): number[] {
    return this.transactions.run(() => {
      if (this.environment.closed()) return [];
      const sequences: number[] = [];
      for (const raw of items) {
        const message = incomingSchema.parse(raw);
        // Only synthetic experiment inputs can enter the conversation journal.
        if (message.platform !== "experiment") continue;
        const sequence = this.repository.write(message);
        if (sequence !== undefined) sequences.push(sequence);
      }
      if (checkpoint)
        this.repository.checkpoint(checkpoint.key, checkpoint.value);
      const reset =
        sequences.length > 0 && this.environment.refreshCollisions();
      for (const sequence of sequences)
        this.transactions.afterCommit(() => this.environment.publish(sequence));
      if (reset) this.transactions.afterCommit(() => this.environment.reset());
      return sequences;
    });
  }
}
