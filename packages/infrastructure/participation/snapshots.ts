import type { DatabaseSync } from "node:sqlite";
import type { ParticipationService } from "../../application/participation/service.ts";
type Snapshot = ReturnType<ParticipationService["snapshot"]>;

/** The broadcast database owns this record; rights records have a separate lifetime. */
export class SqliteParticipationSnapshots {
  constructor(private readonly database: DatabaseSync) {}
  read(): Snapshot | undefined {
    const row = this.database
      .prepare("SELECT value FROM runtime_flags WHERE key='participation'")
      .get();
    return row ? (JSON.parse(String(row.value)) as Snapshot) : undefined;
  }
  save(snapshot: Snapshot) {
    this.database
      .prepare(
        "INSERT INTO runtime_flags(key,value) VALUES('participation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(snapshot));
  }
}
