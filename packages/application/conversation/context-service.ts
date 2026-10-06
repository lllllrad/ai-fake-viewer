import { dependentMessages } from "../../domain/conversation/dependencies.ts";
import {
  summarizeChat,
  retainApprovedSummary,
  summaryWindowMs,
} from "../../domain/conversation/summary.ts";
import type {
  ContextRepository,
  ContextEnvironment,
  ContextTransactions,
} from "./context-ports.ts";

/** Coordinates anonymous context and dependent removal without knowing SQL or HTTP. */
export class ConversationContext {
  constructor(
    private readonly repository: ContextRepository,
    private readonly environment: ContextEnvironment,
    private readonly transactions: ContextTransactions,
  ) {}
  summary(now = this.environment.now()) {
    const session = this.environment.sessionId(),
      prior = this.repository.summary(session);
    const cutoff = prior?.cutoff ?? 0;
    const live = this.environment.liveParticipation();
    const rows = live
      ? this.environment.permittedRows(now, cutoff)
      : this.repository.consentedRows(session, now - summaryWindowMs, cutoff);
    const current = summarizeChat(rows);
    const summary = live
      ? retainApprovedSummary(prior?.payload, current)
      : current;
    this.repository.saveSummary(
      session,
      summary,
      now + summaryWindowMs,
      cutoff,
    );
    return summary;
  }
  clearSummary() {
    return this.transactions.run(() => {
      const session = this.environment.sessionId(),
        now = this.environment.now();
      const empty = summarizeChat([]);
      this.repository.saveSummary(
        session,
        empty,
        now + summaryWindowMs,
        this.environment.lastSequence(),
      );
      this.repository.audit(session, "chat_summary.cleared", now);
      this.transactions.afterCommit(() => this.environment.invalidate());
      return empty;
    });
  }
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
      if (this.environment.liveParticipation()) {
        this.repository.pruneIdentities(session);
        this.environment.refreshIdentityNames();
      }
      // Even uncited context may have influenced an in-flight or published attempt.
      this.repository.clearAttemptContext(session);
      this.summary();
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
  revoke(platform: string, channel: string, author: string) {
    this.transactions.run(() => {
      const ids = this.repository.participantMessages(
        this.environment.sessionId(),
        platform,
        channel,
        author,
      );
      const sequences = this.erase(ids);
      this.transactions.afterCommit(() => {
        this.environment.invalidate();
        this.environment.publishRemoval(sequences);
      });
    });
  }
}
