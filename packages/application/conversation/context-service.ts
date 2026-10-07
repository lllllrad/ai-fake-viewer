import { dependentMessages } from "../../domain/conversation/dependencies.ts";
import type {
  ContextRepository,
  ContextEnvironment,
  ContextTransactions,
} from "./context-ports.ts";

/** Coordinates dependent message removal without knowing SQL or HTTP. */
export class ConversationContext {
  constructor(
    private readonly repository: ContextRepository,
    private readonly environment: ContextEnvironment,
    private readonly transactions: ContextTransactions,
  ) {}
  cancelPendingAttempts() {
    this.repository.cancelPendingAttempts(
      this.environment.sessionId(),
      this.environment.now(),
    );
  }
  recordDependencies(messageId: string, sourceIds: string[]) {
    this.repository.recordDependencies(messageId, sourceIds);
  }
  /** Compatibility entry for ingestion already inside the broadcast transaction. */
  erase(ids: string[]): number[] {
    return this.transactions.run(() => {
      const session = this.environment.sessionId();
      const roots = ids.filter((id) =>
        this.repository.hasMessage(session, id, false),
      );
      const removed = dependentMessages(
        roots,
        this.repository.dependencies(session),
      );
      const sequences = removed.map((id) =>
        this.repository.eraseMessage(session, id, this.environment.now()),
      );
      this.repository.pruneIdentities(session);
      this.environment.refreshIdentityNames();
      // Even uncited context may have influenced an in-flight or published attempt.
      this.repository.clearAttemptContext(session);
      return sequences;
    });
  }
  hide(id: string) {
    this.transactions.run(() => {
      const session = this.environment.sessionId();
      if (!this.repository.hasMessage(session, id, true)) return;
      const sequences = this.erase([id]);
      this.repository.audit(session, "message.hidden", this.environment.now());
      this.transactions.afterCommit(() => {
        this.environment.invalidate();
        this.environment.publishRemoval(sequences);
      });
    });
  }
}
