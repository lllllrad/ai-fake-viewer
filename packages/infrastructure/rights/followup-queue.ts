import { pendingFollowupSchema } from "../../contracts/rights.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  FollowupQueue,
  PendingFollowup,
} from "../../application/rights/withdrawal-followups.ts";
/** Rights work is independent of broadcast lifetime; contains no raw chat or media. */
export class SqliteFollowupQueue implements FollowupQueue {
  constructor(private readonly db: DatabaseSync) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS rights_followup_outbox(key TEXT PRIMARY KEY,payload TEXT NOT NULL)",
    );
  }
  get(key: string) {
    const row = this.db
      .prepare("SELECT payload FROM rights_followup_outbox WHERE key=?")
      .get(key);
    return row
      ? pendingFollowupSchema.parse(JSON.parse(String(row.payload)))
      : undefined;
  }
  save(entry: PendingFollowup) {
    this.db
      .prepare(
        "INSERT INTO rights_followup_outbox VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
      )
      .run(entry.key, JSON.stringify(pendingFollowupSchema.parse(entry)));
  }
  remove(key: string) {
    this.db.prepare("DELETE FROM rights_followup_outbox WHERE key=?").run(key);
  }
  entries() {
    return this.db
      .prepare("SELECT payload FROM rights_followup_outbox ORDER BY rowid")
      .all()
      .map((row) =>
        pendingFollowupSchema.parse(JSON.parse(String(row.payload))),
      );
  }
  count() {
    return Number(
      this.db.prepare("SELECT COUNT(*) n FROM rights_followup_outbox").get()!.n,
    );
  }
}
