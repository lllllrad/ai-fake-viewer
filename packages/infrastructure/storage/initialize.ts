import type { DatabaseSync } from "node:sqlite";
import { broadcastSchemaVersion, migrateBroadcastSchema } from "./schema.ts";
import { recoverBroadcast, type BroadcastRecoveryClock } from "./recovery.ts";

/** Schema upgrades and restart recovery commit together or leave the prior data intact. */
export function initializeBroadcastDatabase(
  database: DatabaseSync,
  clock: BroadcastRecoveryClock,
): string {
  const version = Number(
    database.prepare("PRAGMA user_version").get()!.user_version,
  );
  if (version > broadcastSchemaVersion)
    throw new Error("Broadcast database requires a newer application version");
  database.exec(
    "PRAGMA temp_store=MEMORY; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    migrateBroadcastSchema(database);
    const sessionId = recoverBroadcast(database, clock);
    database.exec(`PRAGMA user_version=${broadcastSchemaVersion}`);
    database.exec("COMMIT");
    return sessionId;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
