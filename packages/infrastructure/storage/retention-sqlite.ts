import type { DatabaseSync } from "node:sqlite";
import type {
  RetentionRepository,
  RetentionInput,
} from "../../application/broadcast/retention.ts";
export class SqliteRetention implements RetentionRepository {
  constructor(private readonly database: DatabaseSync) {}
  purge(input: RetentionInput): boolean {
    const beforeChanges = this.database
      .prepare("SELECT total_changes() n")
      .get()!.n;
    this.database
      .prepare(
        "DELETE FROM chat_context_summaries WHERE expires<? OR session IN (SELECT id FROM sessions WHERE closed<?)",
      )
      .run(input.now, input.before);
    this.database
      .prepare(
        "DELETE FROM persona_publication_outbox WHERE attempt_id IN (SELECT id FROM persona_reaction_attempts WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=? ) AND started_at<?)",
      )
      .run(input.sessionId, input.before);
    this.database
      .prepare(
        "DELETE FROM persona_reaction_attempts WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?) AND started_at<?",
      )
      .run(input.sessionId, input.before);
    this.database
      .prepare(
        "UPDATE persona_reaction_attempts SET result=NULL WHERE result IS NOT NULL AND finished_at<?",
      )
      .run(input.resultBefore);
    const expiredPersonaSessions = this.database
      .prepare(
        "SELECT id FROM persona_sessions WHERE source_session IN (SELECT id FROM sessions WHERE closed<?) OR (state IN ('ended','archived') AND updated<?)",
      )
      .all(input.before, input.before);
    for (const personaSession of expiredPersonaSessions) {
      this.database
        .prepare(
          "DELETE FROM persona_publication_outbox WHERE attempt_id IN (SELECT id FROM persona_reaction_attempts WHERE session_id=?)",
        )
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_reaction_attempts WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_presence WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_cast WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_name_denylist WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_evaluations WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare(
          "DELETE FROM persona_reviews WHERE evaluation_id IN (SELECT id FROM persona_jobs WHERE session_id=?)",
        )
        .run(String(personaSession.id));
      this.database
        .prepare(
          "DELETE FROM persona_model_runs WHERE job_id IN (SELECT id FROM persona_jobs WHERE session_id=?)",
        )
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_jobs WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_audit WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare(
          "DELETE FROM persona_versions WHERE json_extract(provenance,'$.session_id')=?",
        )
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_operator_commands WHERE session_id=?")
        .run(String(personaSession.id));
      this.database
        .prepare("DELETE FROM persona_sessions WHERE id=?")
        .run(String(personaSession.id));
    }
    this.database
      .prepare("DELETE FROM persona_audit WHERE at<?")
      .run(input.auditBefore);
    this.database
      .prepare("DELETE FROM persona_model_runs WHERE started_at<?")
      .run(input.auditBefore);
    this.database.prepare("DELETE FROM events WHERE at<?").run(input.before);
    this.database
      .prepare("DELETE FROM messages WHERE received<?")
      .run(input.before);
    this.database.exec(
      "DELETE FROM ai_message_context WHERE message_id NOT IN (SELECT id FROM messages) OR source_message_id NOT IN (SELECT id FROM messages)",
    );
    this.database
      .prepare("DELETE FROM transcripts WHERE captured<?")
      .run(input.before);
    this.database
      .prepare(
        "DELETE FROM viewer_consents WHERE session IN (SELECT id FROM sessions WHERE closed<?)",
      )
      .run(input.before);
    this.database
      .prepare(
        "DELETE FROM consent_notice_targets WHERE session IN (SELECT id FROM sessions WHERE closed<?)",
      )
      .run(input.before);
    this.database
      .prepare(
        "DELETE FROM consent_notice_state WHERE session IN (SELECT id FROM sessions WHERE closed<?)",
      )
      .run(input.before);
    this.database
      .prepare(
        "DELETE FROM actors_private WHERE id NOT IN (SELECT actor FROM messages)",
      )
      .run();
    this.database.exec(`UPDATE events SET payload=(
      SELECT json_group_array(json(i.value)) FROM json_each(events.payload) i
      WHERE EXISTS(SELECT 1 FROM actors_private a WHERE a.id=json_extract(i.value,'$.actorId'))
    ) WHERE type='identity.revealed' AND EXISTS(
      SELECT 1 FROM json_each(events.payload) i
      WHERE NOT EXISTS(SELECT 1 FROM actors_private a WHERE a.id=json_extract(i.value,'$.actorId'))
    )`);
    this.database
      .prepare("DELETE FROM model_usage WHERE at<? AND session<>?")
      .run(input.before, input.sessionId);
    this.database
      .prepare("DELETE FROM audit_events WHERE at<?")
      .run(input.before);
    this.database
      .prepare("DELETE FROM sessions WHERE closed<? AND id<>?")
      .run(input.before, input.sessionId);

    return (
      this.database.prepare("SELECT total_changes() n").get()!.n !==
      beforeChanges
    );
  }
  compact() {
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
  }
}
