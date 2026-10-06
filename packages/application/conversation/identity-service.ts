import type { ConversationIdentity } from "../../contracts/conversation.ts";
import { collidingNames } from "../../domain/conversation/disclosure.ts";
export interface IdentityRepository {
  visible(sessionId: string, castId?: string): ConversationIdentity[];
  disclose(
    sessionId: string,
    identities: ConversationIdentity[],
    at: number,
  ): number;
  disableAi(): void;
}
/** Commits disclosure and intent together before notifying any reader. */
export class ConversationIdentities {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly transactions: {
      run<T>(work: () => T): T;
      afterCommit(effect: () => void): void;
    },
    private readonly environment: {
      sessionId(): string;
      now(): number;
      rememberCollisions(names: Set<string>): void;
      publish(sequence: number): void;
      reset(): void;
    },
  ) {}
  collisions() {
    return collidingNames(
      this.repository
        .visible(this.environment.sessionId())
        .map((row) => row.displayName),
    );
  }
  reveal(castId?: string): number {
    return this.transactions.run(() => {
      const session = this.environment.sessionId();
      if (castId === undefined) this.repository.disableAi();
      const identities = this.repository.visible(session, castId);
      const sequence = this.repository.disclose(
        session,
        identities,
        this.environment.now(),
      );
      this.environment.rememberCollisions(this.collisions());
      this.transactions.afterCommit(() => this.environment.publish(sequence));
      this.transactions.afterCommit(() => this.environment.reset());
      return identities.length;
    });
  }
}
