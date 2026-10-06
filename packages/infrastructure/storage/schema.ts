import type { DatabaseSync } from "node:sqlite";
export const broadcastSchemaVersion = 3;
const reactionAttemptDefinition = `id TEXT PRIMARY KEY,session_id TEXT NOT NULL,member_id TEXT NOT NULL,event_ids TEXT NOT NULL,context_cutoff INTEGER NOT NULL,session_epoch INTEGER NOT NULL,member_epoch INTEGER NOT NULL,definition_hash TEXT NOT NULL,config_revision INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,model_manifest TEXT,result TEXT,public_message_id TEXT,context_key TEXT NOT NULL,UNIQUE(session_id,member_id,context_key)`;
function tableInfo(database: DatabaseSync, table: string) {
  return database
    .prepare(`SELECT name, pk FROM pragma_table_info(?)`)
    .all(table)
    .map((row) => ({ name: String(row.name), pk: Number(row.pk) }));
}
/** Called inside the startup transaction; supports the historical reference schemas. */
export function migrateBroadcastSchema(database: DatabaseSync) {
  database.exec(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,started INTEGER NOT NULL,closed INTEGER);
 CREATE TABLE IF NOT EXISTS actors_private(id TEXT PRIMARY KEY,session TEXT,source TEXT,author TEXT,name TEXT,UNIQUE(session,source,author));
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session TEXT,actor TEXT,platform TEXT,channel TEXT,source_id TEXT,published INTEGER,received INTEGER,text TEXT,reply TEXT,hidden INTEGER DEFAULT 0,seq INTEGER,UNIQUE(session,platform,channel,source_id));
 CREATE TABLE IF NOT EXISTS chat_context_summaries(session TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL,cutoff INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS ai_message_context(message_id TEXT NOT NULL,source_message_id TEXT NOT NULL,PRIMARY KEY(message_id,source_message_id));
 CREATE INDEX IF NOT EXISTS ai_message_context_source ON ai_message_context(source_message_id);
 CREATE TABLE IF NOT EXISTS viewer_consents(session TEXT NOT NULL,platform TEXT NOT NULL,channel TEXT NOT NULL,author TEXT NOT NULL,granted INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(session,platform,channel,author));
 CREATE TABLE IF NOT EXISTS consent_notice_targets(session TEXT NOT NULL,platform TEXT NOT NULL,channel TEXT NOT NULL,author_hash TEXT NOT NULL,state TEXT NOT NULL,last_notice INTEGER,PRIMARY KEY(session,platform,channel,author_hash));
 CREATE TABLE IF NOT EXISTS consent_notice_state(session TEXT NOT NULL,platform TEXT NOT NULL,channel TEXT NOT NULL,last_notice INTEGER NOT NULL,PRIMARY KEY(session,platform,channel));
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT,type TEXT,target TEXT,at INTEGER,payload TEXT);
 CREATE TABLE IF NOT EXISTS connector_checkpoints(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS model_usage(id TEXT PRIMARY KEY,session TEXT,at INTEGER,reserved REAL,input INTEGER,output INTEGER,status TEXT);
 CREATE TABLE IF NOT EXISTS transcripts(id TEXT PRIMARY KEY,session TEXT NOT NULL,captured INTEGER NOT NULL,text TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS transcripts_captured ON transcripts(captured);
 CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY,session TEXT,at INTEGER,action TEXT);
 CREATE TABLE IF NOT EXISTS runtime_flags(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_templates(id TEXT NOT NULL,revision INTEGER NOT NULL,content TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,revision));
 CREATE TABLE IF NOT EXISTS persona_versions(id TEXT PRIMARY KEY,persona_id TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,provenance TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(persona_id,version));
    CREATE TABLE IF NOT EXISTS persona_sessions(id TEXT PRIMARY KEY,source_session TEXT NOT NULL,revision INTEGER NOT NULL,brief TEXT NOT NULL,policy TEXT NOT NULL,state TEXT NOT NULL,armed INTEGER NOT NULL DEFAULT 0,control_epoch INTEGER NOT NULL DEFAULT 0,disclosure_confirmed INTEGER NOT NULL DEFAULT 0,revealed_at INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_name_denylist(session_id TEXT NOT NULL,normalized_name TEXT NOT NULL,reason TEXT,created INTEGER NOT NULL,PRIMARY KEY(session_id,normalized_name));
 CREATE TABLE IF NOT EXISTS persona_cast(session_id TEXT NOT NULL,member_id TEXT NOT NULL,persona_id TEXT NOT NULL,version_id TEXT NOT NULL,definition_snapshot TEXT NOT NULL,definition_hash TEXT NOT NULL,display_name TEXT NOT NULL,status TEXT NOT NULL,muted INTEGER NOT NULL DEFAULT 0,attention REAL NOT NULL DEFAULT 0.5,focus_tags TEXT NOT NULL DEFAULT '[]',epoch INTEGER NOT NULL DEFAULT 0,guessing_eligible INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(session_id,member_id));
 CREATE TABLE IF NOT EXISTS persona_presence(session_id TEXT NOT NULL,member_id TEXT NOT NULL,interval_no INTEGER NOT NULL,joined_at INTEGER NOT NULL,joined_after_seq INTEGER NOT NULL,left_at INTEGER,left_after_seq INTEGER,PRIMARY KEY(session_id,member_id,interval_no));
 CREATE TABLE IF NOT EXISTS persona_reaction_attempts(${reactionAttemptDefinition});
 CREATE TABLE IF NOT EXISTS persona_publication_outbox(message_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,created INTEGER NOT NULL,dispatched INTEGER,FOREIGN KEY(attempt_id) REFERENCES persona_reaction_attempts(id));
 CREATE TABLE IF NOT EXISTS persona_operator_commands(id TEXT NOT NULL,session_id TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,status_code INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(session_id,operation,id));
 CREATE TABLE IF NOT EXISTS persona_jobs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL,total INTEGER NOT NULL,result TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_model_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,category TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,scenario TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,status TEXT,input_tokens INTEGER,output_tokens INTEGER,manifest TEXT,error_code TEXT);
 CREATE TABLE IF NOT EXISTS persona_evaluations(id TEXT NOT NULL,session_id TEXT NOT NULL,version_id TEXT NOT NULL,fixture_set TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,version_id));
 CREATE TABLE IF NOT EXISTS persona_reviews(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,version_id TEXT NOT NULL,reviewer TEXT NOT NULL,decision TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_audit(id INTEGER PRIMARY KEY,session_id TEXT,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,prior_revision INTEGER,new_revision INTEGER,reason TEXT);
`);
  if (!tableInfo(database, "messages").some((c) => c.name === "consent_epoch"))
    database.exec(
      "ALTER TABLE messages ADD COLUMN consent_epoch INTEGER NOT NULL DEFAULT 0",
    );
  const attemptColumns = tableInfo(database, "persona_reaction_attempts").map(
    (c) => c.name,
  );
  if (!attemptColumns.includes("context_key")) {
    database.exec(`CREATE TABLE persona_reaction_attempts_v3(${reactionAttemptDefinition});
        INSERT INTO persona_reaction_attempts_v3
          SELECT id,session_id,member_id,event_ids,context_cutoff,session_epoch,member_epoch,
            definition_hash,config_revision,state,reason,started_at,finished_at,
            model_manifest,result,public_message_id,'legacy:' || context_cutoff
          FROM persona_reaction_attempts;
        DROP TABLE persona_reaction_attempts;
        ALTER TABLE persona_reaction_attempts_v3 RENAME TO persona_reaction_attempts;`);
  }
  const castColumns = tableInfo(database, "persona_cast").map((c) => c.name);
  if (!castColumns.includes("attention"))
    database.exec(
      "ALTER TABLE persona_cast ADD COLUMN attention REAL NOT NULL DEFAULT 0.5",
    );
  if (!castColumns.includes("focus_tags"))
    database.exec(
      "ALTER TABLE persona_cast ADD COLUMN focus_tags TEXT NOT NULL DEFAULT '[]'",
    );
  const sessionColumns = tableInfo(database, "persona_sessions").map(
    (c) => c.name,
  );
  if (!sessionColumns.includes("revealed_at"))
    database.exec(
      "ALTER TABLE persona_sessions ADD COLUMN revealed_at INTEGER",
    );
  const commandColumns = tableInfo(database, "persona_operator_commands").map(
    (c) => c.name,
  );
  if (!commandColumns.includes("status_code"))
    database.exec(
      "ALTER TABLE persona_operator_commands ADD COLUMN status_code INTEGER NOT NULL DEFAULT 0",
    );
  const commandKeys = tableInfo(database, "persona_operator_commands")
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (commandKeys.join(",") !== "session_id,operation,id")
    database.exec(
      "ALTER TABLE persona_operator_commands RENAME TO persona_operator_commands_old; CREATE TABLE persona_operator_commands(id TEXT NOT NULL,session_id TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,status_code INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(session_id,operation,id)); INSERT INTO persona_operator_commands SELECT id,session_id,operation,request_hash,result,status_code,created FROM persona_operator_commands_old; DROP TABLE persona_operator_commands_old;",
    );
  const templateKeys = tableInfo(database, "persona_templates")
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (templateKeys.join(",") !== "id,revision")
    database.exec(
      "ALTER TABLE persona_templates RENAME TO persona_templates_old; CREATE TABLE persona_templates(id TEXT NOT NULL,revision INTEGER NOT NULL,content TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,revision)); INSERT OR IGNORE INTO persona_templates SELECT id,revision,content,created FROM persona_templates_old; DROP TABLE persona_templates_old;",
    );
  const evaluationKeys = tableInfo(database, "persona_evaluations")
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (evaluationKeys.length === 1 && evaluationKeys[0] === "id")
    database.exec(
      "ALTER TABLE persona_evaluations RENAME TO persona_evaluations_old; CREATE TABLE persona_evaluations(id TEXT NOT NULL,session_id TEXT NOT NULL,version_id TEXT NOT NULL,fixture_set TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,version_id)); INSERT INTO persona_evaluations SELECT * FROM persona_evaluations_old; DROP TABLE persona_evaluations_old;",
    );
}
