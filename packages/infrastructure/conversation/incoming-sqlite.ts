import type { IncomingRepository } from "../../application/conversation/ingestion.ts";
import type { DatabaseSync } from "node:sqlite";
import type { ValidatedIncoming } from "../../contracts/incoming.ts";

/** Writes only admitted input, inside the caller's broadcast transaction. */
export class SqliteIncomingMessages implements IncomingRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly runtime: {
      sessionId(): string;
      now(): number;
      id(): string;
    },
  ) {}
  write(message: ValidatedIncoming, consentEpoch: number): number | undefined {
    const session = this.runtime.sessionId();
    const prior =
      message.sourceId !== null
        ? this.database
            .prepare(
              "SELECT id,actor,text,hidden FROM messages WHERE session=? AND platform=? AND channel=? AND source_id=?",
            )
            .get(session, message.platform, message.channel, message.sourceId)
        : undefined;
    if (prior && (prior.hidden || prior.text === message.text)) return;
    const actor = this.database
      .prepare(
        "SELECT id FROM actors_private WHERE session=? AND source=? AND author=?",
      )
      .get(session, message.platform, message.author);
    // A platform message ID cannot transfer ownership or resurrect a hidden message.
    if (prior && (!actor || prior.actor !== actor.id)) return;
    const now = this.runtime.now();
    if (prior) {
      this.database
        .prepare("UPDATE messages SET text=? WHERE id=?")
        .run(message.text, prior.id!);
      return this.event(session, "message.updated", String(prior.id), now);
    }
    const actorId = actor ? String(actor.id) : this.runtime.id();
    if (!actor)
      this.database
        .prepare("INSERT INTO actors_private VALUES(?,?,?,?,?)")
        .run(actorId, session, message.platform, message.author, message.name);
    const id = this.runtime.id();
    const sequence = this.event(session, "message.added", id, now);
    this.database
      .prepare(
        "INSERT INTO messages(id,session,actor,platform,channel,source_id,published,received,text,reply,seq,consent_epoch) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        session,
        actorId,
        message.platform,
        message.channel,
        message.sourceId,
        message.publishedAt,
        now,
        message.text,
        message.replyToId,
        sequence,
        consentEpoch,
      );
    return sequence;
  }
  checkpoint(key: string, value: string) {
    this.database
      .prepare("INSERT OR REPLACE INTO connector_checkpoints VALUES(?,?)")
      .run(key, value);
  }
  private event(session: string, type: string, target: string, at: number) {
    return Number(
      this.database
        .prepare(
          "INSERT INTO events(session,type,target,at,payload) VALUES(?,?,?,?, 'null')",
        )
        .run(session, type, target, at).lastInsertRowid,
    );
  }
}
