import type { DatabaseSync } from "node:sqlite";
export class SqliteConnectorCheckpoints {
  constructor(private readonly db: DatabaseSync) {}
  get(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM connector_checkpoints WHERE key=?")
      .get(key);
    if (!row) return undefined;
    if (typeof row.value !== "string")
      throw Error("Invalid connector checkpoint");
    return row.value;
  }
  clear(key: string) {
    this.db.prepare("DELETE FROM connector_checkpoints WHERE key=?").run(key);
  }
}
