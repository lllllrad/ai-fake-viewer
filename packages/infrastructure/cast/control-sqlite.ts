import type { DatabaseSync } from "node:sqlite";
import type {
  CastControlRepository,
  CastControlSnapshot,
} from "../../application/cast/control.ts";
export class SqliteCastControl implements CastControlRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly runtime: {
      sessionId(): string;
      closed(): boolean;
      transaction<T>(work: () => T): T;
    },
  ) {}
  transaction<T>(work: () => T) {
    return this.runtime.transaction(work);
  }
  closed() {
    return this.runtime.closed();
  }
  activeId() {
    const row = this.db
      .prepare(
        "SELECT id FROM persona_sessions WHERE source_session=? AND state='live' ORDER BY created DESC LIMIT 1",
      )
      .get(this.runtime.sessionId());
    return row ? String(row.id) : undefined;
  }
  read(id: string) {
    const row = this.db
      .prepare(
        "SELECT id,state,revision,control_epoch FROM persona_sessions WHERE id=? AND source_session=?",
      )
      .get(id, this.runtime.sessionId());
    return row
      ? {
          id: String(row.id),
          state: String(row.state),
          revision: Number(row.revision),
          controlEpoch: Number(row.control_epoch),
        }
      : undefined;
  }
  arm(id: string, now: number) {
    this.db
      .prepare(
        "UPDATE persona_sessions SET armed=1,updated=? WHERE id=? AND source_session=?",
      )
      .run(now, id, this.runtime.sessionId());
  }
  disarm(id: string, reason: string, now: number) {
    this.db
      .prepare(
        "UPDATE persona_sessions SET armed=0,control_epoch=control_epoch+1,updated=? WHERE id=? AND source_session=?",
      )
      .run(now, id, this.runtime.sessionId());
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason=?,finished_at=? WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
      )
      .run(reason, now, id);
  }
  audit(
    snapshot: CastControlSnapshot,
    action: "ai.armed" | "ai.stop",
    now: number,
    reason?: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO persona_audit(session_id,at,actor,action,prior_revision,new_revision,reason) VALUES(?,?,'operator',?,?,?,?)",
      )
      .run(
        snapshot.id,
        now,
        action,
        snapshot.revision,
        snapshot.revision,
        reason ?? null,
      );
  }
}
