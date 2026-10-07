import { SqliteViewerMemory } from "./infrastructure/reactions/viewer-memory-sqlite.ts";
import { SqliteConnectorCheckpoints } from "./infrastructure/storage/connector-checkpoints.ts";
import { ConversationIdentities } from "./application/conversation/identity-service.ts";
import { SqliteConversationIdentities } from "./infrastructure/conversation/identity-sqlite.ts";
import { ConversationIngestion } from "./application/conversation/ingestion.ts";
import { SqliteIncomingMessages } from "./infrastructure/conversation/incoming-sqlite.ts";
import { BroadcastRetention } from "./application/broadcast/retention.ts";
import { SqliteRetention } from "./infrastructure/storage/retention-sqlite.ts";
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
import { emptyChatSummary } from "./domain/conversation/summary.ts";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Incoming } from "./contracts/incoming.ts";
import {
  type ConversationMessage as PublicMessage,
  type PublicEvent,
} from "./contracts/conversation.ts";
export class Store extends EventEmitter {
  db: DatabaseSync;
  readonly viewerMemory: SqliteViewerMemory;
  readonly checkpoints: SqliteConnectorCheckpoints;
  readonly identities: ConversationIdentities;
  readonly ingestion: ConversationIngestion;
  private readonly incomingMessages: SqliteIncomingMessages;
  readonly retention: BroadcastRetention;
  readonly lifetime: BroadcastLifetime;
  private readonly castRuntime: SqliteCastRuntime;
  readonly dispatch: CastDispatch;
  readonly attempts: ReactionAttempts;
  readonly transcripts: TranscriptJournal;
  private readonly transactions: SqliteTransactions;
  private readonly conversationContext: ConversationContext;
  private readonly conversationProjection: ConversationProjection;
  private readonly modelUsage: SqliteModelUsage;
  private readonly publication: LocalPublicationService;
  sessionId: string;
  readerCollisionNames = new Set<string>();
  constructor(
    path: string,
    private readonly live = false,
    private readonly runtime: { now(): number; id(): string } = {
      now: () => Date.now(),
      id: randomUUID,
    },
  ) {
    super();
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      if (path !== ":memory:" && process.platform !== "win32")
        chmodSync(path, 0o600);
      this.sessionId = initializeBroadcastDatabase(this.db, {
        now: () => this.runtime.now(),
        id: () => this.runtime.id(),
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.viewerMemory = new SqliteViewerMemory(
      this.db,
      () => this.sessionId,
      () => this.runtime.now(),
    );
    this.on("context_invalidated", () => this.viewerMemory.clear());
    this.on("reset", () => this.viewerMemory.clear());
    this.checkpoints = new SqliteConnectorCheckpoints(this.db);
    this.incomingMessages = new SqliteIncomingMessages(this.db, {
      sessionId: () => this.sessionId,
      now: () => this.runtime.now(),
      id: () => this.runtime.id(),
    });
    this.castRuntime = new SqliteCastRuntime(this.db, () => this.sessionId);
    this.dispatch = new SqliteCastDispatch(this.db, {
      sessionId: () => this.sessionId,
      closed: () => this.closed(),
      now: () => this.runtime.now(),
      transaction: (work) => this.transaction(work),
    });
    this.attempts = new SqliteReactionAttempts(this.db, {
      sessionId: () => this.sessionId,
      now: () => this.runtime.now(),
    });
    this.transcripts = new TranscriptJournal(new SqliteTranscripts(this.db), {
      sessionId: () => this.sessionId,
      closed: () => this.closed(),
      now: () => this.runtime.now(),
    });
    this.transactions = new SqliteTransactions(this.db, () => {
      const sessionId = this.sessionId;
      const names = new Set(this.readerCollisionNames);
      return () => {
        this.sessionId = sessionId;
        this.readerCollisionNames = names;
      };
    });
    this.identities = new ConversationIdentities(
      new SqliteConversationIdentities(this.db),
      this.transactions,
      {
        sessionId: () => this.sessionId,
        now: () => this.runtime.now(),
        rememberCollisions: (names) => {
          this.readerCollisionNames = names;
        },
        publish: (sequence) => {
          this.emit("event", this.publicEvent(sequence));
        },
        reset: () => {
          this.emit("reset");
        },
      },
    );
    this.ingestion = new ConversationIngestion(
      this.incomingMessages,
      this.transactions,
      {
        closed: () => this.closed(),
        refreshCollisions: () => {
          if (!this.originsRevealed()) return false;
          const colliding = this.collisionNameSet();
          const fresh = [...colliding].some(
            (name) => !this.readerCollisionNames.has(name),
          );
          this.readerCollisionNames = colliding;
          return fresh;
        },
        invalidate: () => {
          this.emit("context_invalidated");
        },
        publish: (sequence) => {
          this.emit("event", this.publicEvent(sequence));
        },
        reset: () => {
          this.emit("reset");
        },
      },
    );
    this.retention = new BroadcastRetention(
      new SqliteRetention(this.db),
      this.transactions,
      {
        sessionId: () => this.sessionId,
        live: () => this.live,
        closed: () => this.closed(),
        now: () => this.runtime.now(),
        refreshSummary: () => {
          this.chatSummary();
        },
        reset: () => {
          this.emit("reset");
        },
      },
    );
    this.lifetime = new BroadcastLifetime(
      new SqliteBroadcastLifetime(this.db),
      this.transactions,
      {
        sessionId: () => this.sessionId,
        closed: () => this.closed(),
        live: () => this.live,
        id: () => this.runtime.id(),
        now: () => this.runtime.now(),
        replace: (sessionId, startedAt, closed, erase) => {
          this.sessionId = sessionId;
          if (erase) this.readerCollisionNames.clear();
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
        id: () => this.runtime.id(),
        now: () => this.runtime.now(),
      },
      this.transactions,
    );
    this.publication = new LocalPublicationService(
      new SqliteLocalPublication(this.db, {
        sessionId: () => this.sessionId,
        id: () => this.runtime.id(),
        now: () => this.runtime.now(),
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
        permitted: (message) => message.attribution === "experiment",
      },
    );
    this.conversationContext = new ConversationContext(
      new SqliteConversationContext(this.db),
      {
        sessionId: () => this.sessionId,
        now: () => this.runtime.now(),
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
    if (this.originsRevealed())
      this.readerCollisionNames = this.collisionNameSet();
  }
  transaction<T>(fn: () => T): T {
    return this.transactions.run(fn);
  }
  audit(action: string) {
    this.db
      .prepare("INSERT INTO audit_events(session,at,action) VALUES(?,?,?)")
      .run(this.sessionId, this.runtime.now(), action);
  }
  event(type: string, target: string | null, payload: unknown = null) {
    const r = this.db
      .prepare(
        "INSERT INTO events(session,type,target,at,payload) VALUES(?,?,?,?,?)",
      )
      .run(
        this.sessionId,
        type,
        target,
        this.runtime.now(),
        JSON.stringify(payload),
      );
    return Number(r.lastInsertRowid);
  }
  ingestBatch(items: Incoming[], checkpoint?: { key: string; value: string }) {
    return this.ingestion.ingest(items, checkpoint);
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
    return this.identities.collisions();
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
  chatSummary() {
    return emptyChatSummary();
  }
  cancelChatContextAttempts() {
    this.conversationContext.cancelPendingAttempts();
  }
  recordAiContext(messageId: string, sourceIds: string[]) {
    this.conversationContext.recordDependencies(messageId, sourceIds);
  }
  hide(id: string) {
    this.conversationContext.hide(id);
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
    return this.checkpoints.get(key);
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
  setAiDesiredRunning(value: boolean) {
    this.db
      .prepare(
        "INSERT INTO runtime_flags(key,value) VALUES('ai_desired_running',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(value ? "1" : "0");
  }
  reveal() {
    this.identities.reveal();
  }
  revealPersonaIdentities(personaSessionId: string) {
    return this.identities.reveal(personaSessionId);
  }
  closeSession() {
    this.lifetime.end();
  }
  newSession() {
    this.lifetime.createNext();
  }
  purge(before: number) {
    return this.retention.purge(before);
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
  reserve(maxUsd: number | null, reserved: number | null) {
    return this.modelUsage.reserve(maxUsd, reserved);
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
