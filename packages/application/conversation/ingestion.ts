import {
  incomingSchema,
  type Incoming,
  type ValidatedIncoming,
} from "../../contracts/incoming.ts";
export interface Admission {
  allow: boolean;
  epoch: number;
  removed?: number[];
  invalidated?: boolean;
}
export interface ReferenceNotice {
  platform: string;
  channel: string;
  occurredAt: number;
}
export interface IncomingRepository {
  write(message: ValidatedIncoming, consentEpoch: number): number | undefined;
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
      admit(message: ValidatedIncoming): Admission;
      summary(): void;
      claimNotices(): ReferenceNotice[];
      refreshCollisions(): boolean;
      invalidate(): void;
      publish(sequence: number): void;
      notice(notice: ReferenceNotice): void;
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
      let invalidated = false;
      for (const raw of items) {
        const message = incomingSchema.parse(raw);
        const admission =
          message.platform === "experiment"
            ? { allow: true, epoch: 0 }
            : this.environment.admit(message);
        if (admission.removed) sequences.push(...admission.removed);
        invalidated ||= !!admission.invalidated;
        if (!admission.allow) continue;
        const sequence = this.repository.write(message, admission.epoch);
        if (sequence !== undefined) sequences.push(sequence);
      }
      if (checkpoint)
        this.repository.checkpoint(checkpoint.key, checkpoint.value);
      this.environment.summary();
      const notices = this.environment.claimNotices();
      const reset =
        sequences.length > 0 && this.environment.refreshCollisions();
      if (invalidated)
        this.transactions.afterCommit(() => this.environment.invalidate());
      for (const sequence of sequences)
        this.transactions.afterCommit(() => this.environment.publish(sequence));
      for (const notice of notices)
        this.transactions.afterCommit(() => this.environment.notice(notice));
      if (reset) this.transactions.afterCommit(() => this.environment.reset());
      return sequences;
    });
  }
}
