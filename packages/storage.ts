import { SqliteCastDispatch } from "./infrastructure/reactions/dispatch-sqlite.ts";
import type { CastDispatch } from "./application/reactions/dispatch.ts";
import { SqliteCastRuntime } from "./infrastructure/cast/runtime-query.ts";
import { SqliteReactionAttempts } from "./infrastructure/reactions/attempts-sqlite.ts";
import type {
  BeginReactionAttempt,
  AttemptOutcome,
  ReactionAttempts,
} from "./application/reactions/attempts.ts";
import { TranscriptJournal } from "./application/inputs/transcript-journal.ts";
import { SqliteTranscripts } from "./infrastructure/inputs/transcripts-sqlite.ts";
import type { Transcript } from "./contracts/transcript.ts";
import { SqliteFollowupQueue } from "./infrastructure/rights/followup-queue.ts";
import { enqueueWithdrawal } from "./application/rights/withdrawal-followups.ts";
import { SqliteModelUsage } from "./infrastructure/reactions/usage-sqlite.ts";
import {
  LocalPublicationService,
  type LocalPublication,
} from "./application/reactions/publication-service.ts";
import { SqliteLocalPublication } from "./infrastructure/conversation/publication-sqlite.ts";
import { ConversationProjection } from "./application/conversation/projection-service.ts";
import { SqliteConversationProjection } from "./infrastructure/conversation/projection-sqlite.ts";
import { ConversationContext } from "./application/conversation/context-service.ts";
import { SqliteConversationContext } from "./infrastructure/conversation/context-sqlite.ts";
import { SqliteTransactions } from "./infrastructure/storage/transactions.ts";
import { SqliteParticipationSnapshots } from "./infrastructure/participation/snapshots.ts";
import type { ParticipationService as Participation } from "./application/participation/service.ts";
import { summaryWindowMs } from "./domain/conversation/summary.ts";
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
  private readonly castRuntime: SqliteCastRuntime;
  readonly dispatch: CastDispatch;
  readonly attempts: ReactionAttempts;
  readonly transcripts: TranscriptJournal;
  readonly rightsFollowups: SqliteFollowupQueue;
  private readonly transactions: SqliteTransactions;
  private readonly participationSnapshots: SqliteParticipationSnapshots;
  private readonly conversationContext: ConversationContext;
  private readonly conversationProjection: ConversationProjection;
  private readonly modelUsage: SqliteModelUsage;
  private readonly publication: LocalPublicationService;
  sessionId: string;
  readerCollisionNames = new Set<string>();
  constructor(
    path: string,
    public participation?: Participation,
  ) {
    super();
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.castRuntime = new SqliteCastRuntime(this.db, () => this.sessionId);
    this.dispatch = new SqliteCastDispatch(this.db, {
      sessionId: () => this.sessionId,
      closed: () => this.closed(),
      now: () => Date.now(),
      transaction: (work) => this.transaction(work),
    });
    this.attempts = new SqliteReactionAttempts(this.db, {
      sessionId: () => this.sessionId,
      now: () => Date.now(),
    });
    this.transcripts = new TranscriptJournal(new SqliteTranscripts(this.db), {
      sessionId: () => this.sessionId,
      closed: () => this.closed(),
      now: () => Date.now(),
    });
    this.rightsFollowups = new SqliteFollowupQueue(this.db);
    this.participationSnapshots = new SqliteParticipationSnapshots(this.db);
    this.transactions = new SqliteTransactions(this.db, () => {
      const sessionId = this.sessionId;
      const names = new Set(this.readerCollisionNames);
      const restoreParticipation = this.participation?.checkpoint();
      return () => {
        this.sessionId = sessionId;
        this.readerCollisionNames = names;
        restoreParticipation?.();
      };
    });
    this.modelUsage = new SqliteModelUsage(
      this.db,
      {
        sessionId: () => this.sessionId,
        id: randomUUID,
        now: () => Date.now(),
      },
      this.transactions,
    );
    this.publication = new LocalPublicationService(
      new SqliteLocalPublication(this.db, {
        sessionId: () => this.sessionId,
        id: randomUUID,
        now: () => Date.now(),
      }),
      this.transactions,
      (receipt) => {
        this.emit("event", this.publicEvent(receipt.sequence));
      },
    );
    this.conversationProjection = new ConversationProjection(
      new SqliteConversationProjection(this.db),
      {
        sessionId: () => this.sessionId,
        closed: () => this.closed(),
        permitted: (message) =>
          !this.participation ||
          (message.sessionId === this.sessionId &&
            (message.attribution === "experiment" ||
              this.participation.allowed(
                message.attribution,
                message.channel,
                message.author,
                message.consentEpoch,
              ))),
      },
    );
    this.conversationContext = new ConversationContext(
      new SqliteConversationContext(this.db),
      {
        sessionId: () => this.sessionId,
        liveParticipation: () => !!this.participation,
        now: () => Date.now(),
        lastSequence: () => this.lastSeq(),
        permittedRows: (now, cutoff) =>
          (this.snapshot().messages.filter(Boolean) as PublicMessage[])
            .filter(
              (message) =>
                message.attribution !== "experiment" &&
                message.displayTime > now - summaryWindowMs &&
                message.seq > cutoff,
            )
            .map((message) => ({ actor: message.actorId, text: message.text })),
        refreshIdentityNames: () => {
          this.readerCollisionNames = this.collisionNameSet();
        },
        publishRemoval: (sequences) => {
          for (const seq of sequences)
            this.emit("event", this.publicEvent(seq));
        },
        invalidate: () => {
          this.emit("context_invalidated");
        },
      },
      this.transactions,
    );
    if (path !== ":memory:" && process.platform !== "win32")
      chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA temp_store=MEMORY; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
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
 CREATE TABLE IF NOT EXISTS persona_reaction_attempts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,member_id TEXT NOT NULL,event_ids TEXT NOT NULL,context_cutoff INTEGER NOT NULL,session_epoch INTEGER NOT NULL,member_epoch INTEGER NOT NULL,definition_hash TEXT NOT NULL,config_revision INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,model_manifest TEXT,result TEXT,public_message_id TEXT,context_key TEXT NOT NULL,UNIQUE(session_id,member_id,context_key));
 CREATE TABLE IF NOT EXISTS persona_publication_outbox(message_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,created INTEGER NOT NULL,dispatched INTEGER,FOREIGN KEY(attempt_id) REFERENCES persona_reaction_attempts(id));
 CREATE TABLE IF NOT EXISTS persona_operator_commands(id TEXT NOT NULL,session_id TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,status_code INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(session_id,operation,id));
 CREATE TABLE IF NOT EXISTS persona_jobs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL,total INTEGER NOT NULL,result TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_model_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,category TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,scenario TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,status TEXT,input_tokens INTEGER,output_tokens INTEGER,manifest TEXT,error_code TEXT);
 CREATE TABLE IF NOT EXISTS persona_evaluations(id TEXT NOT NULL,session_id TEXT NOT NULL,version_id TEXT NOT NULL,fixture_set TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(id,version_id));
 CREATE TABLE IF NOT EXISTS persona_reviews(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,version_id TEXT NOT NULL,reviewer TEXT NOT NULL,decision TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS persona_audit(id INTEGER PRIMARY KEY,session_id TEXT,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,prior_revision INTEGER,new_revision INTEGER,reason TEXT);
 PRAGMA user_version=2;`);
    if (
      !(this.db.prepare("PRAGMA table_info(messages)").all() as any[]).some(
        (c) => c.name === "consent_epoch",
      )
    )
      this.db.exec(
        "ALTER TABLE messages ADD COLUMN consent_epoch INTEGER NOT NULL DEFAULT 0",
      );
    const attemptColumns = (
      this.db.prepare("PRAGMA table_info(persona_reaction_attempts)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    if (!attemptColumns.includes("context_key")) {
      const oldSql = (
        this.db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE name='persona_reaction_attempts'",
          )
          .get() as { sql: string }
      ).sql;
      const replacement = oldSql
        .replace(
          /CREATE TABLE(?: IF NOT EXISTS)? "?persona_reaction_attempts"?/,
          "CREATE TABLE persona_reaction_attempts_v3",
        )
        .replace(
          "UNIQUE(session_id,member_id,context_cutoff)",
          "context_key TEXT NOT NULL,UNIQUE(session_id,member_id,context_key)",
        );
      this.transaction(() => {
        this.db.exec(replacement);
        this.db.exec(
          "INSERT INTO persona_reaction_attempts_v3 SELECT *, 'legacy:' || context_cutoff FROM persona_reaction_attempts; DROP TABLE persona_reaction_attempts; ALTER TABLE persona_reaction_attempts_v3 RENAME TO persona_reaction_attempts;",
        );
      });
    }
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
        "SELECT id FROM sessions ORDER BY started DESC, rowid DESC LIMIT 1",
      )
      .get() as any;
    this.sessionId = active?.id ?? randomUUID();
    if (!active)
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,NULL)")
        .run(this.sessionId, Date.now());
    if (this.participation) {
      this.participation.sessionId = this.sessionId;
      try {
        const saved = this.participationSnapshots.read();
        if (saved) this.participation.restore(saved);
      } catch (error) {
        this.db.close();
        throw error;
      }
      this.participation.bindPersistence({
        run: (work) => this.transaction(work),
        save: () => this.saveParticipation(),
        eraseContext: (participant, followup) => {
          if (followup)
            enqueueWithdrawal(
              this.rightsFollowups,
              {
                participantId: participant.id,
                epoch: participant.epoch,
                platform: participant.platform,
                account: participant.author,
                session: this.sessionId,
                broadcaster: participant.broadcaster,
                published: participant.published,
                requestIds: participant.requestIds,
              },
              randomUUID,
            );
          this.revokeParticipant(
            participant.platform,
            participant.broadcaster,
            participant.author,
          );
        },
        afterCommit: (effect) => this.transactions.afterCommit(effect),
      });
      this.saveParticipation();
    }
    if (this.originsRevealed())
      this.readerCollisionNames = this.collisionNameSet();
  }
  saveParticipation() {
    if (this.participation)
      this.participationSnapshots.save(this.participation.snapshot());
  }
  grantConsent(platform: string, channel: string, author: string) {
    if (this.participation) throw Error("참여자의 직접 동의가 필요합니다.");
    if (platform === "experiment") return;
    this.db
      .prepare(
        "INSERT INTO viewer_consents(session,platform,channel,author,granted,updated) VALUES(?,?,?,?,1,?) ON CONFLICT(session,platform,channel,author) DO UPDATE SET granted=1,updated=excluded.updated",
      )
      .run(this.sessionId, platform, channel, author, Date.now());
  }
  transaction<T>(fn: () => T): T {
    return this.transactions.run(fn);
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
        let consentEpoch = 0;
        if (this.participation && m.platform !== "experiment") {
          const result = this.participation.handle(m);
          consentEpoch = result.epoch;
          if (!result.allow) continue;
        }
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
          !this.participation &&
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
              "INSERT INTO messages(id,session,actor,platform,channel,source_id,published,received,text,reply,seq,consent_epoch) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
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
              consentEpoch,
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
    return this.conversationProjection.message(id);
  }
  publicEvent(seq: number): PublicEvent {
    return this.conversationProjection.event(seq);
  }
  snapshot() {
    return this.conversationProjection.snapshot();
  }
  originsRevealed() {
    return this.conversationProjection.disclosed();
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
    return this.conversationProjection.readerMessage(message, revealed);
  }
  readerSnapshot() {
    return this.conversationProjection.readerSnapshot();
  }
  readerEvent(event: PublicEvent): PublicEvent {
    return this.conversationProjection.readerEvent(event);
  }
  lastSeq() {
    return this.conversationProjection.lastSequence();
  }
  replay(after: number) {
    return this.conversationProjection.replay(after);
  }
  chatSummary(now = Date.now()) {
    return this.conversationContext.summary(now);
  }
  clearChatSummary() {
    return this.conversationContext.clearSummary();
  }
  cancelChatContextAttempts() {
    this.conversationContext.cancelPendingAttempts();
  }
  recordAiContext(messageId: string, sourceIds: string[]) {
    this.conversationContext.recordDependencies(messageId, sourceIds);
  }
  private eraseChatContext(ids: string[], sequences: number[]) {
    sequences.push(...this.conversationContext.erase(ids));
  }
  hide(id: string) {
    this.conversationContext.hide(id);
  }
  revokeParticipant(platform: string, channel: string, author: string) {
    this.conversationContext.revoke(platform, channel, author);
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
    if (this.participation) {
      this.deleteAll(true);
      this.emit("reset");
      return;
    }
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
    if (this.participation) {
      this.participation.sessionId = this.sessionId;
      this.participation.ended = false;
      this.participation.startedAt = Date.now();
    }
    this.saveParticipation();
    this.emit("reset");
  }
  purge(before: number) {
    // An active broadcast owns its history until explicit broadcast end.
    if (this.participation && !this.closed()) return;
    if (!this.participation)
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
  deleteAll(closed = false) {
    this.transaction(() => {
      if (closed) this.participation?.end();
      this.readerCollisionNames.clear();
      this.participation?.participants.clear();
      if (this.participation) this.participation.revision++;
      this.db.exec(
        "DELETE FROM chat_context_summaries; DELETE FROM ai_message_context; DELETE FROM messages; DELETE FROM actors_private; DELETE FROM viewer_consents; DELETE FROM consent_notice_targets; DELETE FROM consent_notice_state; DELETE FROM events; DELETE FROM connector_checkpoints; DELETE FROM model_usage; DELETE FROM transcripts; DELETE FROM audit_events; DELETE FROM persona_model_runs; DELETE FROM persona_reviews; DELETE FROM persona_evaluations; DELETE FROM persona_jobs; DELETE FROM persona_publication_outbox; DELETE FROM persona_reaction_attempts; DELETE FROM persona_presence; DELETE FROM persona_cast; DELETE FROM persona_name_denylist; DELETE FROM persona_audit; DELETE FROM persona_operator_commands; DELETE FROM persona_sessions; DELETE FROM persona_versions WHERE json_extract(provenance,'$.session_id') IS NOT NULL; DELETE FROM sessions; DELETE FROM runtime_flags WHERE key='ai_desired_running' OR key LIKE 'consent_notice:%';",
      );
      this.sessionId = randomUUID();
      if (this.participation) {
        this.participation.sessionId = this.sessionId;
        this.participation.startedAt = Date.now();
        this.participation.ended = closed;
      }
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(this.sessionId, Date.now(), closed ? Date.now() : null);
      this.saveParticipation();
    });
    this.db.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);",
    );
    this.emit("reset");
  }
  recordTranscript(entry: Transcript) {
    return this.transcripts.record(entry);
  }
  recentTranscripts() {
    return this.transcripts.recent();
  }
  clearTranscripts() {
    this.transcripts.clear();
  }
  transcriptCount() {
    return this.transcripts.count();
  }
  transcriptRows(limit = 10) {
    return this.transcripts.rows(limit);
  }
  exportTranscripts() {
    return this.transcripts.export();
  }
  reserve(maxCalls: number, maxUsd: number | null, reserved: number | null) {
    return this.modelUsage.reserve(maxCalls, maxUsd, reserved);
  }
  settle(
    id: string,
    input: number | undefined,
    output: number | undefined,
    cost: number | null,
  ) {
    this.modelUsage.settle(id, input, output, cost);
  }
  usage() {
    return this.modelUsage.usage();
  }
  close() {
    this.saveParticipation();
    this.participation?.bindPersistence(undefined);
    this.db.close();
  }
  personaRuntime() {
    return this.castRuntime.read();
  }
  personaCanPublish(
    sessionId: string,
    memberId: string,
    sessionEpoch: number,
    memberEpoch: number,
    attemptId: string,
  ) {
    return this.dispatch.claim({
      sessionId,
      memberId,
      sessionEpoch,
      memberEpoch,
      attemptId,
    });
  }
  beginPersonaAttempt(input: BeginReactionAttempt) {
    return this.attempts.begin(input);
  }
  finishPersonaAttempt(
    id: string,
    state: AttemptOutcome,
    reason: string | null,
    result: unknown = null,
    manifest: unknown = null,
  ) {
    return this.attempts.finish(id, state, reason, result, manifest);
  }
  publishSynthetic(input: LocalPublication) {
    try {
      return this.publication.publish(input)?.id ?? null;
    } catch {
      return null;
    }
  }
  publishPersona(input: {
    attemptId: string;
    memberId: string;
    name: string;
    text: string;
    replyToId: string | null;
    sourceMessageIds?: string[];
  }) {
    return this.publishSynthetic({
      actor: `persona-${input.memberId}`,
      name: input.name,
      text: input.text,
      replyToId: input.replyToId,
      sourceMessageIds: input.sourceMessageIds ?? [],
      cast: { attemptId: input.attemptId, memberId: input.memberId },
    });
  }
}
