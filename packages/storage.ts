import { initializeBroadcastDatabase } from "./infrastructure/storage/initialize.ts";
import { BroadcastLifetime } from "./application/broadcast/lifetime.ts";
import { SqliteBroadcastLifetime } from "./infrastructure/broadcast/lifetime-sqlite.ts";
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
  readonly lifetime: BroadcastLifetime;
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
    try {
      if (path !== ":memory:" && process.platform !== "win32")
        chmodSync(path, 0o600);
      this.sessionId = initializeBroadcastDatabase(this.db, {
        now: () => Date.now(),
        id: randomUUID,
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
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
    this.lifetime = new BroadcastLifetime(
      new SqliteBroadcastLifetime(this.db),
      this.transactions,
      {
        sessionId: () => this.sessionId,
        closed: () => this.closed(),
        live: () => !!this.participation,
        id: randomUUID,
        now: () => Date.now(),
        replace: (sessionId, startedAt, closed, erase) => {
          this.sessionId = sessionId;
          if (erase) this.readerCollisionNames.clear();
          if (this.participation) {
            if (erase) this.participation.end();
            this.participation.sessionId = sessionId;
            this.participation.startedAt = startedAt;
            this.participation.ended = closed;
          }
          this.saveParticipation();
        },
        reset: () => {
          this.emit("reset");
        },
        closedEvent: (sequence) => {
          this.emit("event", this.publicEvent(sequence));
        },
      },
    );
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
    this.lifetime.end();
  }
  newSession() {
    this.lifetime.createNext();
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
    this.lifetime.erase(closed);
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
