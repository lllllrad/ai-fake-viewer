import type { DatabaseSync } from "node:sqlite";
import type { TranscriptRepository } from "../../application/inputs/transcript-journal.ts";
import {
  transcriptSchema,
  storedTranscriptSchema,
  type Transcript,
} from "../../contracts/transcript.ts";
export class SqliteTranscripts implements TranscriptRepository {
  constructor(private readonly database: DatabaseSync) {}
  insert(sessionId: string, entry: Transcript) {
    this.database
      .prepare(
        "INSERT INTO transcripts(id,session,captured,text) VALUES(?,?,?,?)",
      )
      .run(entry.id, sessionId, entry.capturedAt, entry.text);
  }
  recent(sessionId: string, since: number, limit: number) {
    return this.database
      .prepare(
        "SELECT id,captured AS capturedAt,text FROM transcripts WHERE session=? AND captured>? ORDER BY captured DESC,rowid DESC LIMIT ?",
      )
      .all(sessionId, since, limit)
      .reverse()
      .map((row) => transcriptSchema.parse(row));
  }
  clearAll() {
    this.database.exec("DELETE FROM transcripts");
  }
  countAll() {
    return Number(
      this.database.prepare("SELECT COUNT(*) AS count FROM transcripts").get()!
        .count,
    );
  }
  latestRows(limit: number) {
    return this.database
      .prepare(
        "SELECT id,session AS sessionId,captured AS capturedAt,text FROM transcripts ORDER BY rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => storedTranscriptSchema.parse(row));
  }
  *allRows() {
    const rows = this.database
      .prepare(
        "SELECT id,session AS sessionId,captured AS capturedAt,text FROM transcripts ORDER BY rowid",
      )
      .iterate();
    for (const row of rows) yield storedTranscriptSchema.parse(row);
  }
}
