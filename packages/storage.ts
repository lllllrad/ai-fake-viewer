import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  incomingSchema,
  type Incoming,
  type PublicMessage,
  type PublicEvent,
} from "./contracts.ts";
export class Store extends EventEmitter {
  db: DatabaseSync;
  sessionId: string;
  constructor(path: string) {
    super();
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:" && process.platform !== "win32")
      chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,started INTEGER NOT NULL,closed INTEGER);
 CREATE TABLE IF NOT EXISTS actors_private(id TEXT PRIMARY KEY,session TEXT,source TEXT,author TEXT,name TEXT,UNIQUE(session,source,author));
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session TEXT,actor TEXT,platform TEXT,channel TEXT,source_id TEXT,published INTEGER,received INTEGER,text TEXT,reply TEXT,hidden INTEGER DEFAULT 0,seq INTEGER,UNIQUE(session,platform,channel,source_id));
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT,type TEXT,target TEXT,at INTEGER,payload TEXT);
 CREATE TABLE IF NOT EXISTS connector_checkpoints(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS model_usage(id TEXT PRIMARY KEY,session TEXT,at INTEGER,reserved REAL,input INTEGER,output INTEGER,status TEXT);
 CREATE TABLE IF NOT EXISTS transcripts(id TEXT PRIMARY KEY,session TEXT NOT NULL,captured INTEGER NOT NULL,text TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS transcripts_captured ON transcripts(captured);
 CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY,session TEXT,at INTEGER,action TEXT);
 PRAGMA user_version=1;`);
    const active = this.db
      .prepare(
        "SELECT id FROM sessions WHERE closed IS NULL ORDER BY started DESC LIMIT 1",
      )
      .get() as any;
    this.sessionId = active?.id ?? randomUUID();
    if (!active)
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,NULL)")
        .run(this.sessionId, Date.now());
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(action: string) {
    this.db
      .prepare("INSERT INTO audit_events(session,at,action) VALUES(?,?,?)")
      .run(this.sessionId, Date.now(), action);
  }
  event(type: string, target: string | null, payload: unknown = null) {
    const r = this.db
      .prepare(
        "INSERT INTO events(session,type,target,at,payload) VALUES(?,?,?,?,?)",
      )
      .run(this.sessionId, type, target, Date.now(), JSON.stringify(payload));
    return Number(r.lastInsertRowid);
  }
  ingestBatch(items: Incoming[], checkpoint?: { key: string; value: string }) {
    const seqs: number[] = [];
    this.transaction(() => {
      if (this.closed()) return;
      for (const raw of items) {
        const m = incomingSchema.parse(raw);
        let a = this.db
          .prepare(
            "SELECT * FROM actors_private WHERE session=? AND source=? AND author=?",
          )
          .get(this.sessionId, m.platform, m.author) as any;
        if (!a) {
          a = { id: randomUUID() };
          this.db
            .prepare("INSERT INTO actors_private VALUES(?,?,?,?,?)")
            .run(a.id, this.sessionId, m.platform, m.author, m.name);
        }
        const old = m.sourceId
          ? (this.db
              .prepare(
                "SELECT * FROM messages WHERE session=? AND platform=? AND channel=? AND source_id=?",
              )
              .get(this.sessionId, m.platform, m.channel, m.sourceId) as any)
          : null;
        if (old) {
          if (old.hidden || old.text === m.text) continue;
          this.db
            .prepare("UPDATE messages SET text=? WHERE id=?")
            .run(m.text, old.id);
          seqs.push(this.event("message.updated", old.id));
        } else {
          const id = randomUUID();
          const seq = this.event("message.added", id);
          this.db
            .prepare(
              "INSERT INTO messages(id,session,actor,platform,channel,source_id,published,received,text,reply,seq) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              id,
              this.sessionId,
              a.id,
              m.platform,
              m.channel,
              m.sourceId,
              m.publishedAt,
              Date.now(),
              m.text,
              m.replyToId,
              seq,
            );
          seqs.push(seq);
        }
      }
      if (checkpoint)
        this.db
          .prepare("INSERT OR REPLACE INTO connector_checkpoints VALUES(?,?)")
          .run(checkpoint.key, checkpoint.value);
    });
    for (const seq of seqs) this.emit("event", this.publicEvent(seq));
    return seqs;
  }
  publicMessage(id: string): PublicMessage | null {
    const m = this.db
      .prepare(
        "SELECT m.*,a.name FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.id=? AND m.hidden=0",
      )
      .get(id) as any;
    if (!m) return null;
    return {
      id: m.id,
      sessionId: m.session,
      actorId: m.actor,
      displayName: m.name,
      text: m.text,
      replyToId: m.reply,
      displayTime: m.received,
      attribution: m.platform,
      seq: m.seq,
    };
  }
  publicEvent(seq: number): PublicEvent {
    const e = this.db
      .prepare("SELECT * FROM events WHERE seq=?")
      .get(seq) as any;
    let payload = JSON.parse(e.payload);
    let type = e.type;
    if (type.startsWith("message.")) {
      payload = this.publicMessage(e.target);
      if (!payload) {
        type = "message.hidden";
        payload = { id: e.target };
      }
    }
    return {
      seq: e.seq,
      sessionId: e.session,
      type,
      occurredAt: e.at,
      payload,
    };
  }
  snapshot() {
    const ids = this.db
      .prepare(
        "SELECT id FROM messages WHERE session=? AND hidden=0 ORDER BY seq DESC LIMIT 300",
      )
      .all(this.sessionId) as any[];
    const reveal = this.db
      .prepare(
        "SELECT payload FROM events WHERE session=? AND type='identity.revealed' ORDER BY seq DESC LIMIT 1",
      )
      .get(this.sessionId) as any;
    return {
      type: "snapshot",
      sessionId: this.sessionId,
      lastSeq: this.lastSeq(),
      messages: ids.reverse().map((m) => this.publicMessage(m.id)),
      identities: reveal ? JSON.parse(reveal.payload) : [],
      closed: this.closed(),
    };
  }
  originsRevealed() {
    return !!this.db
      .prepare(
        "SELECT 1 FROM events WHERE session=? AND type='identity.revealed' LIMIT 1",
      )
      .get(this.sessionId);
  }
  readerMessage(
    message: PublicMessage,
    revealed = this.originsRevealed(),
  ): PublicMessage {
    if (revealed) return message;
    return {
      ...message,
      displayName: `시청자-${message.actorId.slice(0, 8)}`,
      attribution: "mixed",
    };
  }
  readerSnapshot() {
    const snapshot = this.snapshot();
    const revealed = this.originsRevealed();
    return {
      ...snapshot,
      messages: snapshot.messages
        .filter((m): m is PublicMessage => m !== null)
        .map((m) => this.readerMessage(m, revealed)),
    };
  }
  readerEvent(event: PublicEvent): PublicEvent {
    if (event.type === "message.added" || event.type === "message.updated")
      return {
        ...event,
        payload: this.readerMessage(event.payload as PublicMessage),
      };
    return event;
  }
  lastSeq() {
    return Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE session=?",
          )
          .get(this.sessionId) as any
      ).seq,
    );
  }
  replay(after: number) {
    return (
      this.db
        .prepare(
          "SELECT seq FROM events WHERE session=? AND seq>? ORDER BY seq LIMIT 1001",
        )
        .all(this.sessionId, after) as any[]
    ).map((e) => this.publicEvent(e.seq));
  }
  hide(id: string) {
    let seq = 0;
    this.transaction(() => {
      const m = this.db
        .prepare(
          "SELECT id FROM messages WHERE id=? AND session=? AND hidden=0",
        )
        .get(id, this.sessionId);
      if (!m) return;
      this.db
        .prepare("UPDATE messages SET hidden=1,text='' WHERE id=?")
        .run(id);
      seq = this.event("message.hidden", id);
      this.audit("message.hidden");
    });
    if (seq) this.emit("event", this.publicEvent(seq));
  }
  context(allowed: string[]) {
    return (this.snapshot().messages.filter(Boolean) as PublicMessage[])
      .filter((m) => allowed.includes(m.attribution))
      .slice(-80)
      .map((m) => ({
        id: m.id,
        speaker: `${m.attribution === "experiment" ? "spectator" : "viewer"}-${m.actorId}`,
        text: m.text.slice(0, 500),
      }));
  }
  checkpoint(key: string) {
    return (
      this.db
        .prepare("SELECT value FROM connector_checkpoints WHERE key=?")
        .get(key) as any
    )?.value;
  }
  closed() {
    return !!(
      this.db
        .prepare("SELECT closed FROM sessions WHERE id=?")
        .get(this.sessionId) as any
    )?.closed;
  }
  reveal() {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT a.id,a.name,a.source FROM actors_private a JOIN messages m ON m.actor=a.id WHERE a.session=? AND m.hidden=0",
      )
      .all(this.sessionId) as any[];
    const seq = this.event(
      "identity.revealed",
      null,
      rows.map((a) => ({
        actorId: a.id,
        displayName: a.name,
        kind:
          a.source === "experiment" ? "system_generated" : "platform_received",
      })),
    );
    this.emit("event", this.publicEvent(seq));
    this.emit("reset");
  }
  closeSession() {
    if (this.closed()) return;
    this.db
      .prepare("UPDATE sessions SET closed=? WHERE id=?")
      .run(Date.now(), this.sessionId);
    const seq = this.event("session.closed", null);
    this.emit("event", this.publicEvent(seq));
  }
  newSession() {
    this.closeSession();
    this.sessionId = randomUUID();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,NULL)")
      .run(this.sessionId, Date.now());
    this.emit("reset");
  }
  purge(before: number) {
    if (
      !this.db
        .prepare("SELECT 1 FROM messages WHERE received<? LIMIT 1")
        .get(before) &&
      !this.db
        .prepare("SELECT 1 FROM transcripts WHERE captured<? LIMIT 1")
        .get(before)
    )
      return;
    this.transaction(() => {
      this.db.prepare("DELETE FROM events WHERE at<?").run(before);
      this.db.prepare("DELETE FROM messages WHERE received<?").run(before);
      this.db.prepare("DELETE FROM transcripts WHERE captured<?").run(before);
      this.db
        .prepare(
          "DELETE FROM actors_private WHERE id NOT IN (SELECT actor FROM messages)",
        )
        .run();
      this.db.exec("DELETE FROM events WHERE type='identity.revealed'");
      this.db
        .prepare("DELETE FROM model_usage WHERE at<? AND session<>?")
        .run(before, this.sessionId);
      this.db.prepare("DELETE FROM audit_events WHERE at<?").run(before);
      this.db.prepare("DELETE FROM sessions WHERE closed<?").run(before);
    });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    this.emit("reset");
  }
  deleteAll() {
    this.db.exec(
      "DELETE FROM messages; DELETE FROM actors_private; DELETE FROM events; DELETE FROM connector_checkpoints; DELETE FROM model_usage; DELETE FROM transcripts; DELETE FROM audit_events; DELETE FROM sessions;",
    );
    this.sessionId = randomUUID();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,NULL)")
      .run(this.sessionId, Date.now());
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    this.emit("reset");
  }
  recordTranscript(entry: { id: string; capturedAt: number; text: string }) {
    if (this.closed()) return false;
    if (
      !Number.isSafeInteger(entry.capturedAt) ||
      !entry.text.trim() ||
      entry.text.length > 1000
    )
      throw Error("Invalid transcript");
    this.db
      .prepare(
        "INSERT INTO transcripts(id,session,captured,text) VALUES(?,?,?,?)",
      )
      .run(entry.id, this.sessionId, entry.capturedAt, entry.text);
    return true;
  }
  transcriptCount() {
    return (
      this.db.prepare("SELECT COUNT(*) AS count FROM transcripts").get() as {
        count: number;
      }
    ).count;
  }
  transcriptRows(limit = 10) {
    return this.db
      .prepare(
        "SELECT id,session AS sessionId,captured AS capturedAt,text FROM transcripts ORDER BY rowid DESC LIMIT ?",
      )
      .all(limit) as {
      id: string;
      sessionId: string;
      capturedAt: number;
      text: string;
    }[];
  }
  *exportTranscripts() {
    const rows = this.db
      .prepare(
        "SELECT id,session AS sessionId,captured AS capturedAt,text FROM transcripts ORDER BY rowid",
      )
      .iterate();
    for (const row of rows) yield JSON.stringify(row) + "\n";
  }
  reserve(maxCalls: number, maxUsd: number | null, reserved: number | null) {
    return this.transaction(() => {
      const usage = this.usage();
      if (
        usage.calls >= maxCalls ||
        (maxUsd !== null && usage.reservedUsd + (reserved ?? 0) > maxUsd)
      )
        return null;
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO model_usage(id,session,at,reserved,status) VALUES(?,?,?,?,?)",
        )
        .run(id, this.sessionId, Date.now(), reserved, "reserved");
      return id;
    });
  }
  settle(
    id: string,
    input: number | undefined,
    output: number | undefined,
    cost: number | null,
  ) {
    this.db
      .prepare(
        "UPDATE model_usage SET input=?,output=?,reserved=COALESCE(?,reserved),status=? WHERE id=?",
      )
      .run(input ?? null, output ?? null, cost, "completed", id);
  }
  usage() {
    const r = this.db
      .prepare(
        "SELECT COUNT(*) calls,COALESCE(SUM(reserved),0) reservedUsd,SUM(input) inputTokens,SUM(output) outputTokens FROM model_usage WHERE session=?",
      )
      .get(this.sessionId) as any;
    return r as {
      calls: number;
      reservedUsd: number;
      inputTokens: number | null;
      outputTokens: number | null;
    };
  }
  close() {
    this.db.close();
  }
}
