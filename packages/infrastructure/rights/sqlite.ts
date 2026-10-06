import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { RightsService } from "../../application/rights/service.ts";
import type { RightsRepository } from "../../application/rights/ports.ts";
import {
  rightsRecordSchema,
  videoRecordSchema,
  type RightsRecord,
  type VideoRecord,
} from "../../contracts/rights.ts";
export class SqliteRightsRepository implements RightsRepository {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS rights_requests(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rights_followup_receipts(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,platform TEXT NOT NULL,url TEXT NOT NULL,broadcast_at TEXT NOT NULL,status TEXT NOT NULL);",
    );
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  receivedFollowup(id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM rights_followup_receipts WHERE id=?")
      .get(id);
  }
  acknowledgeFollowup(id: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO rights_followup_receipts VALUES(?)")
      .run(id);
  }
  insert(record: RightsRecord) {
    this.db
      .prepare("INSERT INTO rights_requests VALUES(?,?,?)")
      .run(
        record.id,
        JSON.stringify(rightsRecordSchema.parse(record)),
        record.createdAt,
      );
  }
  find(id: string) {
    const row = this.db
      .prepare("SELECT payload FROM rights_requests WHERE id=?")
      .get(id);
    return row
      ? rightsRecordSchema.parse(JSON.parse(String(row.payload)))
      : undefined;
  }
  save(record: RightsRecord) {
    this.db
      .prepare("UPDATE rights_requests SET payload=? WHERE id=?")
      .run(JSON.stringify(rightsRecordSchema.parse(record)), record.id);
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM rights_requests WHERE id=?").run(id);
  }
  list() {
    return this.db
      .prepare("SELECT payload FROM rights_requests ORDER BY created DESC")
      .all()
      .map((row) => rightsRecordSchema.parse(JSON.parse(String(row.payload))));
  }
  addVideo(record: VideoRecord) {
    const value = videoRecordSchema.parse(record);
    this.db
      .prepare("INSERT INTO videos VALUES(?,?,?,?,?)")
      .run(
        value.id,
        value.platform,
        value.url,
        value.broadcastAt,
        value.status,
      );
  }
  videos() {
    return this.db
      .prepare(
        "SELECT id,platform,url,broadcast_at AS broadcastAt,status FROM videos",
      )
      .all()
      .map((row) => videoRecordSchema.parse(row));
  }
  close() {
    this.db.close();
  }
}
export function createRightsService(path: string) {
  return new RightsService(new SqliteRightsRepository(path), {
    id: randomUUID,
    now: Date.now,
  });
}
