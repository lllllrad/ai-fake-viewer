import type { DatabaseSync } from "node:sqlite";
import type { BroadcastLifetimeRepository } from "../../application/broadcast/lifetime.ts";

/** Broadcast records are disposable; account tokens are not. */
export class SqliteBroadcastLifetime implements BroadcastLifetimeRepository {
  constructor(private readonly database: DatabaseSync) {}
  erase() {
    this.database.exec(
      `
      DELETE FROM viewer_memory;
      DELETE FROM ai_message_context;
      DELETE FROM messages;
      DELETE FROM actors_private;
      DELETE FROM events;
      DELETE FROM connector_checkpoints;
      DELETE FROM model_usage;
      DELETE FROM transcripts;
      DELETE FROM audit_events;
      DELETE FROM persona_model_runs;
      DELETE FROM persona_reviews;
      DELETE FROM persona_evaluations;
      DELETE FROM persona_jobs;
      DELETE FROM persona_publication_outbox;
      DELETE FROM persona_reaction_attempts;
      DELETE FROM persona_presence;
      DELETE FROM persona_cast;
      DELETE FROM persona_name_denylist;
      DELETE FROM persona_audit;
      DELETE FROM persona_operator_commands;
      DELETE FROM persona_sessions;
      DELETE FROM persona_versions WHERE json_extract(provenance,'$.session_id') IS NOT NULL;
      DELETE FROM sessions;
      DELETE FROM runtime_flags WHERE key='ai_desired_running';
      `,
    );
  }
  create(id: string, at: number, closed: boolean) {
    this.database
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(id, at, closed ? at : null);
  }
  closeReference(id: string, at: number) {
    this.database.prepare("DELETE FROM viewer_memory WHERE session=?").run(id);
    this.database
      .prepare(
        "INSERT INTO runtime_flags(key,value) VALUES('ai_desired_running','0') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run();
    this.database
      .prepare(
        "UPDATE persona_sessions SET state='ended',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE source_session=? AND state IN ('live','paused')",
      )
      .run(at, id);
    this.database
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason='source_session_closed',finished_at=? WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?) AND state IN ('generating','candidate','dispatching')",
      )
      .run(at, id);
    this.database
      .prepare("UPDATE sessions SET closed=? WHERE id=?")
      .run(at, id);
    return Number(
      this.database
        .prepare(
          "INSERT INTO events(session,type,target,at,payload) VALUES(?,'session.closed',NULL,?,'null')",
        )
        .run(id, at).lastInsertRowid,
    );
  }
  compact() {
    this.database.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);",
    );
  }
}
