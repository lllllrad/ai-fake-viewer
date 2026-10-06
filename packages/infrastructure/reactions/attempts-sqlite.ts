import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ReactionAttempts,
  BeginReactionAttempt,
  AttemptOutcome,
} from "../../application/reactions/attempts.ts";
export class SqliteReactionAttempts implements ReactionAttempts {
  constructor(
    private readonly database: DatabaseSync,
    private readonly runtime: { sessionId(): string; now(): number },
  ) {}
  begin(input: BeginReactionAttempt) {
    const contextKey =
      input.contextKey ??
      createHash("sha256")
        .update(JSON.stringify([input.cutoff, input.eventIds]))
        .digest("hex");
    return (
      this.database
        .prepare(
          `
      INSERT INTO persona_reaction_attempts(
        id,session_id,member_id,event_ids,context_cutoff,session_epoch,member_epoch,
        definition_hash,config_revision,state,started_at,context_key)
      SELECT ?,s.id,m.member_id,?,?,s.control_epoch,m.epoch,m.definition_hash,s.revision,'generating',?,?
      FROM persona_sessions s
      JOIN persona_cast m ON m.session_id=s.id
      JOIN sessions b ON b.id=s.source_session
      WHERE s.id=? AND m.member_id=? AND s.source_session=? AND b.closed IS NULL
        AND s.state='live' AND s.armed=1 AND s.control_epoch=?
        AND m.status='present' AND m.muted=0 AND m.epoch=?
        AND m.definition_hash=? AND s.revision=?
      ON CONFLICT(session_id,member_id,context_key) DO NOTHING
    `,
        )
        .run(
          input.id,
          JSON.stringify(input.eventIds),
          input.cutoff,
          this.runtime.now(),
          contextKey,
          input.sessionId,
          input.memberId,
          this.runtime.sessionId(),
          input.sessionEpoch,
          input.memberEpoch,
          input.definitionHash,
          input.configRevision,
        ).changes > 0
    );
  }
  finish(
    id: string,
    state: AttemptOutcome,
    reason: string | null,
    result: unknown = null,
    manifest: unknown = null,
  ) {
    return (
      this.database
        .prepare(
          `
      UPDATE persona_reaction_attempts AS a
      SET state=?,reason=?,result=?,model_manifest=COALESCE(?,model_manifest),finished_at=?
      WHERE a.id=? AND a.state NOT IN ('published','skipped','suppressed','expired','canceled','failed')
        AND EXISTS(SELECT 1 FROM persona_sessions s WHERE s.id=a.session_id AND s.source_session=?)
        AND (?<>'candidate' OR (a.state='generating' AND EXISTS(
          SELECT 1 FROM persona_sessions s JOIN persona_cast m ON m.session_id=s.id
          JOIN sessions b ON b.id=s.source_session
          WHERE s.id=a.session_id AND m.member_id=a.member_id AND b.closed IS NULL
            AND s.state='live' AND s.armed=1 AND s.control_epoch=a.session_epoch
            AND s.revision=a.config_revision AND m.status='present' AND m.muted=0
            AND m.epoch=a.member_epoch AND m.definition_hash=a.definition_hash
        )))
    `,
        )
        .run(
          state,
          reason,
          result === null ? null : JSON.stringify(result),
          manifest === null ? null : JSON.stringify(manifest),
          this.runtime.now(),
          id,
          this.runtime.sessionId(),
          state,
        ).changes > 0
    );
  }
}
