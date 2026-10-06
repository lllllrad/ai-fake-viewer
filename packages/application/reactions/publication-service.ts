export interface LocalPublication {
  actor: string;
  name: string;
  text: string;
  replyToId: string | null;
  sourceMessageIds: string[];
  cast?: { attemptId: string; memberId: string };
}
export interface PublicationReceipt {
  id: string;
  sequence: number;
}
export interface PublicationRepository {
  write(input: LocalPublication): PublicationReceipt | null;
  recordSources(messageId: string, sourceIds: string[]): void;
}
export interface PublicationTransactions {
  run<T>(work: () => T): T;
  afterCommit(effect: () => void): void;
}
/** Publication and its full source context commit before any reader notification. */
export class LocalPublicationService {
  constructor(
    private readonly repository: PublicationRepository,
    private readonly transactions: PublicationTransactions,
    private readonly notify: (receipt: PublicationReceipt) => void,
  ) {}
  publish(input: LocalPublication) {
    return this.transactions.run(() => {
      const receipt = this.repository.write(input);
      if (!receipt) return null;
      this.repository.recordSources(receipt.id, [
        ...new Set(input.sourceMessageIds),
      ]);
      this.transactions.afterCommit(() => {
        try {
          this.notify(receipt);
        } catch {
          /* Durable publication remains available in reconnect snapshots. */
        }
      });
      return receipt;
    });
  }
}
