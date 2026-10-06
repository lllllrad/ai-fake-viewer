import type { DatabaseSync } from "node:sqlite";
export interface BroadcastRecoveryClock {
  now(): number;
  id(): string;
}
/** Restart invalidates unfinished work, but retains operator intent and broadcast data. */
export function recoverBroadcast(
  database: DatabaseSync,
  clock: BroadcastRecoveryClock,
): string {
  const now = clock.now();
  database
    .prepare(
      "DELETE FROM persona_operator_commands WHERE status_code=0 AND created<?",
    )
    .run(now - 60 * 60 * 1000);
  database
    .prepare(
      "UPDATE persona_sessions SET control_epoch=control_epoch+1,updated=? WHERE state='live'",
    )
    .run(now);
  database
    .prepare(
      "UPDATE persona_reaction_attempts SET state='canceled',reason='server_restart',finished_at=? WHERE state IN ('generating','candidate','dispatching')",
    )
    .run(now);
  database.exec(`INSERT OR IGNORE INTO ai_message_context(message_id,source_message_id)
    SELECT p.public_message_id,j.value FROM persona_reaction_attempts p,json_each(p.model_manifest,'$.inputMessages') j
    WHERE p.public_message_id IS NOT NULL AND p.model_manifest IS NOT NULL AND j.type='text'`);
  const active = database
    .prepare(
      "SELECT id FROM sessions ORDER BY started DESC, rowid DESC LIMIT 1",
    )
    .get();
  if (active) return String(active.id);
  const id = clock.id();
  database.prepare("INSERT INTO sessions VALUES(?,?,NULL)").run(id, now);
  return id;
}
