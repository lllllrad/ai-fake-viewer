import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { conversationIdentitySchema } from "../../contracts/conversation.ts";
import type {
  ConversationReadRepository,
  StoredConversationMessage,
  StoredConversationEvent,
} from "../../application/conversation/projection-ports.ts";

const columns =
  "m.id,m.session,m.actor,m.platform,m.channel,m.text,m.reply,m.received,m.seq,m.consent_epoch,a.name,a.author";
function message(
  row: Record<string, SQLOutputValue>,
): StoredConversationMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session),
    actorId: String(row.actor),
    attribution: String(row.platform),
    channel: String(row.channel),
    text: String(row.text),
    replyToId: row.reply === null ? null : String(row.reply),
    displayTime: Number(row.received),
    seq: Number(row.seq),
    consentEpoch: Number(row.consent_epoch),
    displayName: String(row.name),
    author: String(row.author),
  };
}
export class SqliteConversationProjection implements ConversationReadRepository {
  constructor(private readonly database: DatabaseSync) {}
  message(id: string) {
    const row = this.database
      .prepare(
        `SELECT ${columns} FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.id=? AND m.hidden=0`,
      )
      .get(id);
    return row ? message(row) : undefined;
  }
  recentMessages(session: string) {
    return this.database
      .prepare(
        `SELECT ${columns} FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.hidden=0 ORDER BY m.seq DESC LIMIT 300`,
      )
      .all(session)
      .reverse()
      .map(message);
  }
  event(sequence: number): StoredConversationEvent | undefined {
    const row = this.database
      .prepare(
        "SELECT seq,session,type,target,at,payload FROM events WHERE seq=?",
      )
      .get(sequence);
    if (!row) return undefined;
    const raw: unknown = JSON.parse(String(row.payload));
    return {
      seq: Number(row.seq),
      sessionId: String(row.session),
      type: String(row.type),
      target: row.target === null ? null : String(row.target),
      occurredAt: Number(row.at),
      payload:
        row.type === "identity.revealed"
          ? conversationIdentitySchema.array().parse(raw)
          : raw,
    };
  }
  latestIdentities(session: string) {
    const row = this.database
      .prepare(
        "SELECT payload FROM events WHERE session=? AND type='identity.revealed' ORDER BY seq DESC LIMIT 1",
      )
      .get(session);
    return row
      ? conversationIdentitySchema
          .array()
          .parse(JSON.parse(String(row.payload)))
      : undefined;
  }
  disclosed(session: string) {
    return !!this.database
      .prepare(
        "SELECT 1 FROM events WHERE session=? AND type='identity.revealed' LIMIT 1",
      )
      .get(session);
  }
  lastSequence(session: string) {
    return Number(
      this.database
        .prepare(
          "SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE session=?",
        )
        .get(session)!.seq,
    );
  }
  replaySequences(session: string, after: number) {
    return this.database
      .prepare(
        "SELECT seq FROM events WHERE session=? AND seq>? ORDER BY seq LIMIT 1001",
      )
      .all(session, after)
      .map((row) => Number(row.seq));
  }
}
