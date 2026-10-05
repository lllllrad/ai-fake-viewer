import { summarizeChat, summaryWindowMs } from "./chat-summary.ts";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
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
  readerCollisionNames = new Set<string>();
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
 CREATE TABLE IF NOT EXISTS persona_reaction_attempts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,member_id TEXT NOT NULL,event_ids TEXT NOT NULL,context_cutoff INTEGER NOT NULL,session_epoch INTEGER NOT NULL,member_epoch INTEGER NOT NULL,definition_hash TEXT NOT NULL,config_revision INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,model_manifest TEXT,result TEXT,public_message_id TEXT,UNIQUE(session_id,member_id,context_cutoff));
 CREATE TABLE IF NOT EXISTS persona_publication_outbox(message_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,created INTEGER NOT NULL,dispatched INTEGER,FOREIGN KEY(attempt_id) REFERENCES persona_reaction_attempts(id));
 CREATE TABLE IF NOT EXISTS persona_operator_commands(id TEXT NOT NULL,session_id TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,status_code INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(session_id,operation,id));
 CREATE TABLE IF NOT EXISTS persona_jobs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL,total INTEGER NOT NULL,result TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_model_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,category TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,scenario TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,status TEXT,input_tokens INTEGER,output_tokens INTEGER,manifest TEXT,error_code TEXT);
 CREATE TABLE IF NOT EXISTS persona_evaluations(id TEXT NOT NULL,session_id TEXT NOT NULL,version_id TEXT NOT NULL,fixture_set TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,version_id));
 CREATE TABLE IF NOT EXISTS persona_reviews(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,version_id TEXT NOT NULL,reviewer TEXT NOT NULL,decision TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_audit(id INTEGER PRIMARY KEY,session_id TEXT,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,prior_revision INTEGER,new_revision INTEGER,reason TEXT);
 PRAGMA user_version=2;`);
    const castColumns = (
      this.db.prepare("PRAGMA table_info(persona_cast)").all() as any[]
    ).map((c) => c.name);
    if (!castColumns.includes("attention"))
      this.db.exec(
        "ALTER TABLE persona_cast ADD COLUMN attention REAL NOT NULL DEFAULT 0.5",
      );
    if (!castColumns.includes("focus_tags"))
      this.db.exec(
        "ALTER TABLE persona_cast ADD COLUMN focus_tags TEXT NOT NULL DEFAULT '[]'",
      );
    const sessionColumns = (
      this.db.prepare("PRAGMA table_info(persona_sessions)").all() as any[]
    ).map((c) => c.name);
    if (!sessionColumns.includes("revealed_at"))
      this.db.exec(
        "ALTER TABLE persona_sessions ADD COLUMN revealed_at INTEGER",
      );
    const commandColumns = (
      this.db
        .prepare("PRAGMA table_info(persona_operator_commands)")
        .all() as any[]
    ).map((c) => c.name);
    if (!commandColumns.includes("status_code"))
      this.db.exec(
        "ALTER TABLE persona_operator_commands ADD COLUMN status_code INTEGER NOT NULL DEFAULT 0",
      );
    const commandKeys = (
      this.db
        .prepare("PRAGMA table_info(persona_operator_commands)")
        .all() as any[]
    )
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    if (commandKeys.join(",") !== "session_id,operation,id")
      this.db.exec(
        "ALTER TABLE persona_operator_commands RENAME TO persona_operator_commands_old; CREATE TABLE persona_operator_commands(id TEXT NOT NULL,session_id TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,status_code INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(session_id,operation,id)); INSERT INTO persona_operator_commands SELECT id,session_id,operation,request_hash,result,status_code,created FROM persona_operator_commands_old; DROP TABLE persona_operator_commands_old;",
      );
    const templateKeys = (
      this.db.prepare("PRAGMA table_info(persona_templates)").all() as any[]
    )
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    if (templateKeys.join(",") !== "id,revision")
      this.db.exec(
        "ALTER TABLE persona_templates RENAME TO persona_templates_old; CREATE TABLE persona_templates(id TEXT NOT NULL,revision INTEGER NOT NULL,content TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,revision)); INSERT OR IGNORE INTO persona_templates SELECT id,revision,content,created FROM persona_templates_old; DROP TABLE persona_templates_old;",
      );
    this.db
      .prepare(
        "DELETE FROM persona_operator_commands WHERE status_code=0 AND created<?",
      )
      .run(Date.now() - 60 * 60 * 1000);
    const evaluationKeys = (
      this.db.prepare("PRAGMA table_info(persona_evaluations)").all() as any[]
    )
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    if (evaluationKeys.length === 1 && evaluationKeys[0] === "id")
      this.db.exec(
        "ALTER TABLE persona_evaluations RENAME TO persona_evaluations_old; CREATE TABLE persona_evaluations(id TEXT NOT NULL,session_id TEXT NOT NULL,version_id TEXT NOT NULL,fixture_set TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,version_id)); INSERT INTO persona_evaluations SELECT * FROM persona_evaluations_old; DROP TABLE persona_evaluations_old;",
      );
    this.db.exec(
      "UPDATE persona_sessions SET control_epoch=control_epoch+1,updated=unixepoch('subsec')*1000 WHERE state='live'; UPDATE persona_reaction_attempts SET state='canceled',reason='server_restart',finished_at=unixepoch('subsec')*1000 WHERE state IN ('generating','candidate','dispatching');",
    );
    this.db
      .exec(`INSERT OR IGNORE INTO ai_message_context(message_id,source_message_id)
      SELECT p.public_message_id,j.value FROM persona_reaction_attempts p,json_each(p.model_manifest,'$.inputMessages') j
      WHERE p.public_message_id IS NOT NULL AND p.model_manifest IS NOT NULL AND j.type='text'`);
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
    if (this.originsRevealed())
      this.readerCollisionNames = this.collisionNameSet();
  }
  grantConsent(platform: string, channel: string, author: string) {
    if (platform === "experiment") return;
    this.db
      .prepare(
        "INSERT INTO viewer_consents(session,platform,channel,author,granted,updated) VALUES(?,?,?,?,1,?) ON CONFLICT(session,platform,channel,author) DO UPDATE SET granted=1,updated=excluded.updated",
      )
      .run(this.sessionId, platform, channel, author, Date.now());
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
    let invalidated = false;
    this.transaction(() => {
      if (this.closed()) return;
      for (const raw of items) {
        const m = incomingSchema.parse(raw);
        const command = m.text.trim().toLocaleLowerCase();
        if (
          m.platform !== "experiment" &&
          (command === "!동의" || command === "!철회")
        ) {
          const granted = command === "!동의";
          this.db
            .prepare(
              "INSERT INTO viewer_consents(session,platform,channel,author,granted,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(session,platform,channel,author) DO UPDATE SET granted=excluded.granted,updated=excluded.updated",
            )
            .run(
              this.sessionId,
              m.platform,
              m.channel,
              m.author,
              granted ? 1 : 0,
              Date.now(),
            );
          this.db
            .prepare(
              "INSERT INTO consent_notice_targets(session,platform,channel,author_hash,state,last_notice) VALUES(?,?,?,?,?,NULL) ON CONFLICT(session,platform,channel,author_hash) DO UPDATE SET state=excluded.state",
            )
            .run(
              this.sessionId,
              m.platform,
              m.channel,
              this.viewerHash(m.platform, m.channel, m.author),
              granted ? "consented" : "withdrawn",
            );
          if (!granted) {
            const oldMessages = this.db
              .prepare(
                "SELECT id FROM messages WHERE session=? AND platform=? AND channel=? AND actor IN (SELECT id FROM actors_private WHERE session=? AND source=? AND author=?) ",
              )
              .all(
                this.sessionId,
                m.platform,
                m.channel,
                this.sessionId,
                m.platform,
                m.author,
              ) as any[];
            this.eraseChatContext(
              oldMessages.map((old) => old.id),
              seqs,
            );
            invalidated = true;
          }
          this.audit(
            granted ? "viewer.consent.granted" : "viewer.consent.withdrawn",
          );
          continue;
        }
        if (
          m.platform !== "experiment" &&
          !(
            this.db
              .prepare(
                "SELECT granted FROM viewer_consents WHERE session=? AND platform=? AND channel=? AND author=?",
              )
              .get(this.sessionId, m.platform, m.channel, m.author) as any
          )?.granted
        ) {
          this.recordConsentNoticeTarget(m);
          continue;
        }
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
    if (invalidated) this.emit("context_invalidated");
    this.chatSummary();
    for (const seq of seqs) this.emit("event", this.publicEvent(seq));
    this.emitConsentNoticeIfDue();
    this.emitConsentNoticeIfDue();
    if (seqs.length && this.originsRevealed()) {
      const colliding = this.collisionNameSet();
      const fresh = [...colliding].some(
        (name) => !this.readerCollisionNames.has(name),
      );
      this.readerCollisionNames = colliding;
      if (fresh) this.emit("reset");
    }
    return seqs;
  }
  private viewerHash(platform: string, channel: string, author: string) {
    return createHash("sha256")
      .update(`${platform}\0${channel}\0${author}`)
      .digest("hex");
  }
  private recordConsentNoticeTarget(m: Incoming) {
    const authorHash = this.viewerHash(m.platform, m.channel, m.author);
    this.db
      .prepare(
        "INSERT INTO consent_notice_targets(session,platform,channel,author_hash,state,last_notice) VALUES(?,?,?,?, 'pending',NULL) ON CONFLICT(session,platform,channel,author_hash) DO NOTHING",
      )
      .run(this.sessionId, m.platform, m.channel, authorHash);
  }
  private emitConsentNoticeIfDue(now = Date.now()) {
    const due = this.db
      .prepare(
        "SELECT platform,channel FROM consent_notice_targets WHERE session=? AND state='pending' GROUP BY platform,channel",
      )
      .all(this.sessionId) as any[];
    for (const target of due) {
      const state = this.db
        .prepare(
          "SELECT last_notice FROM consent_notice_state WHERE session=? AND platform=? AND channel=?",
        )
        .get(this.sessionId, target.platform, target.channel) as any;
      if (state && now - state.last_notice < 30000) continue;
      this.db
        .prepare(
          "INSERT INTO consent_notice_state(session,platform,channel,last_notice) VALUES(?,?,?,?) ON CONFLICT(session,platform,channel) DO UPDATE SET last_notice=excluded.last_notice",
        )
        .run(this.sessionId, target.platform, target.channel, now);
      this.db
        .prepare(
          "UPDATE consent_notice_targets SET last_notice=? WHERE session=? AND platform=? AND channel=? AND state='pending'",
        )
        .run(now, this.sessionId, target.platform, target.channel);
      this.emit("consent_notice", {
        platform: target.platform,
        channel: target.channel,
        occurredAt: now,
      });
    }
  }
  pendingConsentNotice(platform: string, channel: string) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM consent_notice_targets WHERE session=? AND platform=? AND channel=? AND state='pending' LIMIT 1",
      )
      .get(this.sessionId, platform, channel);
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
      payload =
        type === "message.added" || type === "message.updated"
          ? this.publicMessage(e.target)
          : { id: e.target };
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
  private collisionNameSet() {
    const names = this.db
      .prepare(
        "SELECT DISTINCT a.id,a.name FROM actors_private a JOIN messages m ON m.actor=a.id WHERE m.session=? AND m.hidden=0",
      )
      .all(this.sessionId) as any[];
    const counts = new Map<string, number>();
    for (const row of names) {
      const key = row.name
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\p{Cf}\p{P}]/gu, "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      [...counts].filter(([, count]) => count > 1).map(([key]) => key),
    );
  }
  readerMessage(
    message: PublicMessage,
    revealed = this.originsRevealed(),
  ): PublicMessage {
    const displayName =
      message.attribution === "youtube"
        ? message.displayName.replace(/^@/, "")
        : message.attribution === "experiment"
          ? message.displayName.replace(/\s*·\s*experiment\s*$/i, "").trim() ||
            "시청자"
          : message.displayName;
    if (revealed) {
      const normalized = displayName
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\p{Cf}\p{P}]/gu, "");
      const names = this.db
        .prepare(
          "SELECT DISTINCT a.id,a.name FROM actors_private a JOIN messages m ON m.actor=a.id WHERE m.session=? AND m.hidden=0",
        )
        .all(message.sessionId) as any[];
      const collisions = names.filter(
        (a) =>
          a.name
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/[\s\p{Cf}\p{P}]/gu, "") === normalized,
      );
      const rendered =
        collisions.length > 1
          ? `${displayName} · ${message.actorId.slice(0, 4)}`
          : displayName;
      return { ...message, displayName: rendered };
    }
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
    if (event.type.startsWith("message."))
      return { ...event, payload: { id: (event.payload as any)?.id } };
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
  chatSummary(now = Date.now()) {
    const prior = this.db
      .prepare("SELECT cutoff FROM chat_context_summaries WHERE session=?")
      .get(this.sessionId) as any;
    const rows = this.db
      .prepare(
        `SELECT m.actor,m.text FROM messages m JOIN actors_private a ON a.id=m.actor
      JOIN viewer_consents c ON c.session=m.session AND c.platform=m.platform AND c.channel=m.channel AND c.author=a.author
      WHERE m.session=? AND m.hidden=0 AND m.platform<>'experiment' AND c.granted=1 AND m.received>? AND m.seq>?
      ORDER BY m.seq DESC LIMIT 300`,
      )
      .all(this.sessionId, now - summaryWindowMs, prior?.cutoff ?? 0) as Array<{
      actor: string;
      text: string;
    }>;
    const summary = summarizeChat(rows);
    this.db
      .prepare(
        "INSERT INTO chat_context_summaries(session,payload,expires,cutoff) VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET payload=excluded.payload,expires=excluded.expires",
      )
      .run(
        this.sessionId,
        JSON.stringify(summary),
        now + summaryWindowMs,
        prior?.cutoff ?? 0,
      );
    return summary;
  }
  clearChatSummary() {
    this.db
      .prepare(
        "INSERT INTO chat_context_summaries(session,payload,expires,cutoff) VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET payload=excluded.payload,expires=excluded.expires,cutoff=excluded.cutoff",
      )
      .run(
        this.sessionId,
        JSON.stringify(summarizeChat([])),
        Date.now() + summaryWindowMs,
        this.lastSeq(),
      );
    this.emit("context_invalidated");
    this.audit("chat_summary.cleared");
    return this.chatSummary();
  }
  cancelChatContextAttempts() {
    this.db
      .prepare(
        `UPDATE persona_reaction_attempts SET state='canceled',reason='chat_context_removed',result=NULL,model_manifest=NULL,finished_at=?
      WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?) AND state IN ('generating','candidate','dispatching')`,
      )
      .run(Date.now(), this.sessionId);
  }
  recordAiContext(messageId: string, sourceIds: string[]) {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO ai_message_context VALUES(?,?)",
    );
    for (const id of sourceIds) insert.run(messageId, id);
  }
  // Called inside the removal transaction. Include indirect AI responses so that
  // an earlier paraphrase cannot reintroduce withdrawn text into future inputs.
  private eraseChatContext(ids: string[], seqs: number[]) {
    const removed = new Set(ids);
    for (const id of removed) {
      const derived = this.db
        .prepare(
          `SELECT m.id FROM messages m WHERE m.session=? AND m.platform='experiment' AND
        (m.reply=? OR m.id IN (SELECT message_id FROM ai_message_context WHERE source_message_id=?))`,
        )
        .all(this.sessionId, id, id) as any[];
      for (const row of derived) removed.add(row.id);
    }
    for (const id of removed) {
      this.db
        .prepare("UPDATE messages SET hidden=1,text='' WHERE id=?")
        .run(id);
      seqs.push(this.event("message.hidden", id));
      this.db
        .prepare(
          "DELETE FROM ai_message_context WHERE message_id=? OR source_message_id=?",
        )
        .run(id, id);
    }
    // In-flight models may have used any earlier context, not just cited IDs.
    this.db
      .prepare(
        `UPDATE persona_reaction_attempts SET result=NULL,model_manifest=NULL,event_ids='[]',
      state=CASE WHEN state IN ('generating','candidate','dispatching') THEN 'canceled' ELSE state END,
      reason='chat_context_removed' WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?)`,
      )
      .run(this.sessionId);
    this.chatSummary();
  }
  hide(id: string) {
    const seqs: number[] = [];
    this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT id FROM messages WHERE id=? AND session=? AND hidden=0",
        )
        .get(id, this.sessionId);
      if (!row) return;
      this.eraseChatContext([id], seqs);
      this.audit("message.hidden");
    });
    if (seqs.length) this.emit("context_invalidated");
    for (const seq of seqs) this.emit("event", this.publicEvent(seq));
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
  aiDesiredRunning() {
    return (
      (
        this.db
          .prepare(
            "SELECT value FROM runtime_flags WHERE key='ai_desired_running'",
          )
          .get() as any
      )?.value === "1"
    );
  }
  consentNoticeEnabled(platform: string, defaultValue = false) {
    const value = this.db
      .prepare("SELECT value FROM runtime_flags WHERE key=?")
      .get(`consent_notice:${platform}`) as any;
    return value ? value.value === "1" : defaultValue;
  }
  setConsentNoticeEnabled(platform: string, enabled: boolean) {
    this.db
      .prepare(
        "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(`consent_notice:${platform}`, enabled ? "1" : "0");
    this.audit(
      `consent_notice.${platform}.${enabled ? "enabled" : "disabled"}`,
    );
  }
  setAiDesiredRunning(value: boolean) {
    this.db
      .prepare(
        "INSERT INTO runtime_flags(key,value) VALUES('ai_desired_running',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(value ? "1" : "0");
  }
  reveal() {
    this.setAiDesiredRunning(false);
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
    this.readerCollisionNames = this.collisionNameSet();
    this.emit("event", this.publicEvent(seq));
    this.emit("reset");
  }
  revealPersonaIdentities(personaSessionId: string) {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT a.id,a.name FROM actors_private a JOIN messages m ON m.actor=a.id JOIN persona_cast c ON c.session_id=? AND a.author=('persona-'||c.member_id) WHERE a.session=? AND m.hidden=0 AND m.platform='experiment'",
      )
      .all(personaSessionId, this.sessionId) as any[];
    const seq = this.event(
      "identity.revealed",
      null,
      rows.map((a) => ({
        actorId: a.id,
        displayName: a.name,
        kind: "system_generated",
      })),
    );
    this.readerCollisionNames = this.collisionNameSet();
    this.emit("event", this.publicEvent(seq));
    this.emit("reset");
    return rows.length;
  }
  closeSession() {
    if (this.closed()) return;
    this.setAiDesiredRunning(false);
    this.db
      .prepare(
        "UPDATE persona_sessions SET state='ended',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE source_session=? AND state IN ('live','paused')",
      )
      .run(Date.now(), this.sessionId);
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason='source_session_closed',finished_at=? WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?) AND state IN ('generating','candidate','dispatching')",
      )
      .run(Date.now(), this.sessionId);
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
    this.db
      .prepare(
        "DELETE FROM chat_context_summaries WHERE expires<? OR session IN (SELECT id FROM sessions WHERE closed<?)",
      )
      .run(Date.now(), before);
    this.db.exec(
      "DELETE FROM ai_message_context WHERE message_id NOT IN (SELECT id FROM messages) OR source_message_id NOT IN (SELECT id FROM messages)",
    );
    if (
      !this.db
        .prepare("SELECT 1 FROM messages WHERE received<? LIMIT 1")
        .get(before) &&
      !this.db
        .prepare("SELECT 1 FROM transcripts WHERE captured<? LIMIT 1")
        .get(before) &&
      !this.db
        .prepare(
          "SELECT 1 FROM persona_sessions WHERE source_session IN (SELECT id FROM sessions WHERE closed<?) OR (state IN ('ended','archived') AND updated<?) LIMIT 1",
        )
        .get(before, before) &&
      !this.db
        .prepare("SELECT 1 FROM persona_audit WHERE at<? LIMIT 1")
        .get(Date.now() - 90 * 86400000) &&
      !this.db
        .prepare("SELECT 1 FROM persona_model_runs WHERE started_at<? LIMIT 1")
        .get(Date.now() - 90 * 86400000)
    )
      return;
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM persona_publication_outbox WHERE attempt_id IN (SELECT id FROM persona_reaction_attempts WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=? ) AND started_at<?)",
        )
        .run(this.sessionId, before);
      this.db
        .prepare(
          "DELETE FROM persona_reaction_attempts WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?) AND started_at<?",
        )
        .run(this.sessionId, before);
      this.db
        .prepare(
          "UPDATE persona_reaction_attempts SET result=NULL WHERE finished_at<?",
        )
        .run(Date.now() - 24 * 60 * 60 * 1000);
      const expiredPersonaSessions = this.db
        .prepare(
          "SELECT id FROM persona_sessions WHERE source_session IN (SELECT id FROM sessions WHERE closed<?) OR (state IN ('ended','archived') AND updated<?)",
        )
        .all(before, before) as any[];
      for (const personaSession of expiredPersonaSessions) {
        this.db
          .prepare(
            "DELETE FROM persona_publication_outbox WHERE attempt_id IN (SELECT id FROM persona_reaction_attempts WHERE session_id=?)",
          )
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_reaction_attempts WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_presence WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_cast WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_name_denylist WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_evaluations WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare(
            "DELETE FROM persona_reviews WHERE evaluation_id IN (SELECT id FROM persona_jobs WHERE session_id=?)",
          )
          .run(personaSession.id);
        this.db
          .prepare(
            "DELETE FROM persona_model_runs WHERE job_id IN (SELECT id FROM persona_jobs WHERE session_id=?)",
          )
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_jobs WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_audit WHERE session_id=?")
          .run(personaSession.id);
        this.db
          .prepare(
            "DELETE FROM persona_versions WHERE json_extract(provenance,'$.session_id')=?",
          )
          .run(personaSession.id);
        this.db
          .prepare("DELETE FROM persona_sessions WHERE id=?")
          .run(personaSession.id);
      }
      this.db
        .prepare("DELETE FROM persona_audit WHERE at<?")
        .run(Date.now() - 90 * 86400000);
      this.db
        .prepare("DELETE FROM persona_model_runs WHERE started_at<?")
        .run(Date.now() - 90 * 86400000);
      this.db.prepare("DELETE FROM events WHERE at<?").run(before);
      this.db.prepare("DELETE FROM messages WHERE received<?").run(before);
      this.db.exec(
        "DELETE FROM ai_message_context WHERE message_id NOT IN (SELECT id FROM messages) OR source_message_id NOT IN (SELECT id FROM messages)",
      );
      this.chatSummary();
      this.db.prepare("DELETE FROM transcripts WHERE captured<?").run(before);
      this.db
        .prepare(
          "DELETE FROM viewer_consents WHERE session IN (SELECT id FROM sessions WHERE closed<?)",
        )
        .run(before);
      this.db
        .prepare(
          "DELETE FROM consent_notice_targets WHERE session IN (SELECT id FROM sessions WHERE closed<?)",
        )
        .run(before);
      this.db
        .prepare(
          "DELETE FROM consent_notice_state WHERE session IN (SELECT id FROM sessions WHERE closed<?)",
        )
        .run(before);
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
      "DELETE FROM chat_context_summaries; DELETE FROM ai_message_context; DELETE FROM messages; DELETE FROM actors_private; DELETE FROM viewer_consents; DELETE FROM consent_notice_targets; DELETE FROM consent_notice_state; DELETE FROM events; DELETE FROM connector_checkpoints; DELETE FROM model_usage; DELETE FROM transcripts; DELETE FROM audit_events; DELETE FROM persona_model_runs; DELETE FROM persona_reviews; DELETE FROM persona_evaluations; DELETE FROM persona_jobs; DELETE FROM persona_publication_outbox; DELETE FROM persona_reaction_attempts; DELETE FROM persona_presence; DELETE FROM persona_cast; DELETE FROM persona_name_denylist; DELETE FROM persona_audit; DELETE FROM persona_operator_commands; DELETE FROM persona_sessions; DELETE FROM persona_versions WHERE json_extract(provenance,'$.session_id') IS NOT NULL; DELETE FROM sessions; DELETE FROM runtime_flags WHERE key='ai_desired_running' OR key LIKE 'consent_notice:%';",
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
  personaRuntime() {
    const s = this.db
      .prepare(
        "SELECT * FROM persona_sessions WHERE source_session=? AND state='live' ORDER BY created DESC LIMIT 1",
      )
      .get(this.sessionId) as any;
    if (!s) return null;
    const members = this.db
      .prepare(
        "SELECT * FROM persona_cast WHERE session_id=? AND status='present' AND muted=0 ORDER BY rowid",
      )
      .all(s.id) as any[];
    return {
      id: s.id,
      revision: s.revision,
      armed: !!s.armed,
      controlEpoch: s.control_epoch,
      configRevision: s.revision,
      policy: JSON.parse(s.policy),
      brief: JSON.parse(s.brief),
      members: members.map((m) => {
        const last = this.db
          .prepare(
            "SELECT MAX(m.received) at FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND a.author=? AND m.hidden=0",
          )
          .get(this.sessionId, `persona-${m.member_id}`) as any;
        const recent = this.db
          .prepare(
            "SELECT a.author FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.platform='experiment' AND m.hidden=0 ORDER BY m.seq DESC LIMIT 5",
          )
          .all(this.sessionId) as any[];
        let consecutive = 0;
        for (const x of recent) {
          if (x.author !== `persona-${m.member_id}`) break;
          consecutive++;
        }
        return {
          id: m.member_id,
          personaId: m.persona_id,
          versionId: m.version_id,
          snapshot: JSON.parse(m.definition_snapshot),
          hash: m.definition_hash,
          displayName: m.display_name,
          epoch: m.epoch,
          attention: m.attention,
          focusTags: JSON.parse(m.focus_tags),
          guessingEligible: !!m.guessing_eligible,
          lastPublishedAt: last.at ?? null,
          consecutiveMessages: consecutive,
          presence: this.db
            .prepare(
              "SELECT * FROM persona_presence WHERE session_id=? AND member_id=? ORDER BY interval_no",
            )
            .all(s.id, m.member_id) as any[],
        };
      }),
    };
  }
  personaCanPublish(
    sessionId: string,
    memberId: string,
    sessionEpoch: number,
    memberEpoch: number,
    attemptId: string,
  ) {
    try {
      return this.transaction(() => {
        const s = this.db
          .prepare("SELECT * FROM persona_sessions WHERE id=?")
          .get(sessionId) as any;
        const m = this.db
          .prepare(
            "SELECT * FROM persona_cast WHERE session_id=? AND member_id=?",
          )
          .get(sessionId, memberId) as any;
        const a = this.db
          .prepare("SELECT * FROM persona_reaction_attempts WHERE id=?")
          .get(attemptId) as any;
        if (
          !s ||
          !m ||
          !a ||
          s.source_session !== this.sessionId ||
          s.state !== "live" ||
          !s.armed ||
          s.control_epoch !== sessionEpoch ||
          m.status !== "present" ||
          m.muted ||
          m.epoch !== memberEpoch ||
          a.state !== "candidate"
        )
          return false;
        const policy = JSON.parse(s.policy),
          now = Date.now(),
          windowMs = policy.rolling_window_ms ?? 60000;
        const upstream = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) n FROM messages WHERE session=? AND platform<>'experiment' AND hidden=0 AND received>=?",
              )
              .get(this.sessionId, now - windowMs) as any
          ).n,
        );
        const synthetic = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) n FROM messages WHERE session=? AND platform='experiment' AND hidden=0 AND received>=?",
              )
              .get(this.sessionId, now - windowMs) as any
          ).n,
        );
        const band = (policy.upstream_activity_bands ?? []).find(
          (b: any) =>
            upstream >= b.min_messages &&
            (b.max_messages === null || upstream <= b.max_messages),
        );
        const cap = Math.min(
          policy.global_hard_cap_messages_per_window ?? 6,
          band?.ai_cap_messages_per_window ?? 6,
        );
        const reservations = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) n FROM persona_reaction_attempts WHERE session_id=? AND state IN ('generating','candidate','dispatching') AND started_at>=?",
              )
              .get(sessionId, now - windowMs) as any
          ).n,
        );
        if (synthetic + reservations > cap) return false;
        const gap = policy.minimum_global_gap_ms ?? 5000;
        if (
          Number(
            (
              this.db
                .prepare(
                  "SELECT COUNT(*) n FROM messages WHERE session=? AND platform='experiment' AND received>=?",
                )
                .get(this.sessionId, now - gap) as any
            ).n,
          ) > 0
        )
          return false;
        const memberCooldown = policy.persona_cooldown_ms ?? 30000;
        if (
          Number(
            (
              this.db
                .prepare(
                  "SELECT COUNT(*) n FROM persona_reaction_attempts WHERE session_id=? AND member_id=? AND state='published' AND finished_at>=?",
                )
                .get(sessionId, memberId, now - memberCooldown) as any
            ).n,
          ) > 0
        )
          return false;
        const inflight = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) n FROM persona_reaction_attempts WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
              )
              .get(sessionId) as any
          ).n,
        );
        if (inflight > (policy.max_inflight_per_session ?? 2)) return false;
        const consecutiveLimit =
          policy.max_consecutive_messages_from_one_persona ?? 2;
        const latest = this.db
          .prepare(
            "SELECT a.author FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.platform='experiment' AND m.hidden=0 ORDER BY m.seq DESC LIMIT ?",
          )
          .all(this.sessionId, consecutiveLimit) as any[];
        if (
          latest.length >= consecutiveLimit &&
          latest.every((x) => x.author === `persona-${memberId}`)
        )
          return false;
        for (const sourceId of JSON.parse(a.event_ids) as string[]) {
          const message = this.db
            .prepare(
              "SELECT 1 FROM messages WHERE id=? AND session=? AND hidden=0",
            )
            .get(sourceId, this.sessionId);
          const transcript = this.db
            .prepare("SELECT 1 FROM transcripts WHERE id=? AND session=?")
            .get(sourceId, this.sessionId);
          if (!message && !transcript) return false;
        }
        const proposed = JSON.parse(a.result ?? "null")?.text as
          string | undefined;
        if (proposed) {
          const normalized = proposed
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/[\s\p{Cf}\p{P}]/gu, "");
          if ([...normalized].length >= 12) {
            const prior = this.db
              .prepare(
                "SELECT m.text FROM messages m JOIN actors_private p ON p.id=m.actor WHERE m.session=? AND p.author LIKE 'persona-%' AND m.hidden=0 AND m.received>=?",
              )
              .all(this.sessionId, now - 120000) as any[];
            if (
              prior.some(
                (x) =>
                  x.text
                    .normalize("NFKC")
                    .toLocaleLowerCase()
                    .replace(/[\s\p{Cf}\p{P}]/gu, "") === normalized,
              )
            )
              return false;
          }
        }
        this.db
          .prepare(
            "UPDATE persona_reaction_attempts SET state='dispatching' WHERE id=? AND state='candidate'",
          )
          .run(attemptId);
        return true;
      });
    } catch {
      return false;
    }
  }
  beginPersonaAttempt(input: {
    id: string;
    sessionId: string;
    memberId: string;
    eventIds: string[];
    cutoff: number;
    sessionEpoch: number;
    memberEpoch: number;
    definitionHash: string;
    configRevision: number;
  }) {
    this.db
      .prepare(
        "INSERT INTO persona_reaction_attempts(id,session_id,member_id,event_ids,context_cutoff,session_epoch,member_epoch,definition_hash,config_revision,state,started_at) VALUES(?,?,?,?,?,?,?,?,?,'generating',?)",
      )
      .run(
        input.id,
        input.sessionId,
        input.memberId,
        JSON.stringify(input.eventIds),
        input.cutoff,
        input.sessionEpoch,
        input.memberEpoch,
        input.definitionHash,
        input.configRevision,
        Date.now(),
      );
  }
  finishPersonaAttempt(
    id: string,
    state:
      | "skipped"
      | "suppressed"
      | "expired"
      | "canceled"
      | "failed"
      | "candidate"
      | "published",
    reason: string | null,
    result: unknown = null,
    manifest: unknown = null,
  ) {
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state=?,reason=?,result=?,model_manifest=COALESCE(?,model_manifest),finished_at=? WHERE id=? AND state NOT IN ('published','skipped','suppressed','expired','canceled','failed')",
      )
      .run(
        state,
        reason,
        result === null ? null : JSON.stringify(result),
        manifest === null ? null : JSON.stringify(manifest),
        Date.now(),
        id,
      );
  }
  publishPersona(input: {
    attemptId: string;
    memberId: string;
    name: string;
    text: string;
    replyToId: string | null;
  }) {
    try {
      return this.transaction(() => {
        const attempt = this.db
          .prepare(
            "SELECT * FROM persona_reaction_attempts WHERE id=? AND state='dispatching'",
          )
          .get(input.attemptId) as any;
        const s = attempt
          ? (this.db
              .prepare("SELECT * FROM persona_sessions WHERE id=?")
              .get(attempt.session_id) as any)
          : null;
        const member = attempt
          ? (this.db
              .prepare(
                "SELECT * FROM persona_cast WHERE session_id=? AND member_id=?",
              )
              .get(attempt.session_id, input.memberId) as any)
          : null;
        if (
          !attempt ||
          !s ||
          !member ||
          s.source_session !== this.sessionId ||
          s.state !== "live" ||
          !s.armed ||
          s.control_epoch !== attempt.session_epoch ||
          member.status !== "present" ||
          member.muted ||
          member.epoch !== attempt.member_epoch ||
          member.definition_hash !== attempt.definition_hash
        )
          return null;
        const author = `persona-${input.memberId}`;
        let actor = (
          this.db
            .prepare(
              "SELECT id FROM actors_private WHERE session=? AND source=? AND author=?",
            )
            .get(this.sessionId, "experiment", author) as any
        )?.id as string | undefined;
        if (!actor) {
          actor = randomUUID();
          this.db
            .prepare(
              "INSERT INTO actors_private(id,session,source,author,name) VALUES(?,?,?,?,?)",
            )
            .run(actor, this.sessionId, "experiment", author, input.name);
        }
        const id = randomUUID(),
          now = Date.now();
        const seq = Number(
          this.db
            .prepare(
              "INSERT INTO events(session,type,target,at,payload) VALUES(?,'message.added',?,?,?)",
            )
            .run(this.sessionId, id, now, JSON.stringify({})).lastInsertRowid,
        );
        this.db
          .prepare(
            "INSERT INTO messages(id,session,actor,platform,channel,source_id,published,received,text,reply,hidden,seq) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
          )
          .run(
            id,
            this.sessionId,
            actor,
            "experiment",
            this.sessionId,
            input.attemptId,
            now,
            now,
            input.text,
            input.replyToId,
            seq,
          );
        this.db
          .prepare(
            "INSERT OR IGNORE INTO persona_publication_outbox(message_id,attempt_id,state,created,dispatched) VALUES(?,?,'dispatched',?,?)",
          )
          .run(id, input.attemptId, now, now);
        this.db
          .prepare(
            "UPDATE persona_reaction_attempts SET state='published',finished_at=?,public_message_id=? WHERE id=? AND state='dispatching'",
          )
          .run(now, id, input.attemptId);
        this.emit("event", this.publicEvent(seq));
        return id;
      });
    } catch {
      return null;
    }
  }
}
