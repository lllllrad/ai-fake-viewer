import type { DatabaseSync } from "node:sqlite";
import { conversationIdentitySchema } from "../../contracts/conversation.ts";
import type {
  ContextRepository,
  SummaryRow,
} from "../../application/conversation/context-ports.ts";
import type { ChatSummary } from "../../domain/conversation/summary.ts";
import type { MessageDependency } from "../../domain/conversation/dependencies.ts";

const identitiesSchema = conversationIdentitySchema.array();
export class SqliteConversationContext implements ContextRepository {
  constructor(private readonly database: DatabaseSync) {}
  summary(session: string) {
    const row = this.database
      .prepare(
        "SELECT payload,cutoff FROM chat_context_summaries WHERE session=?",
      )
      .get(session);
    return row
      ? {
          payload: JSON.parse(String(row.payload)) as unknown,
          cutoff: Number(row.cutoff),
        }
      : undefined;
  }
  saveSummary(
    session: string,
    value: ChatSummary,
    expires: number,
    cutoff: number,
  ) {
    this.database
      .prepare(
        "INSERT INTO chat_context_summaries(session,payload,expires,cutoff) VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET payload=excluded.payload,expires=excluded.expires,cutoff=excluded.cutoff",
      )
      .run(session, JSON.stringify(value), expires, cutoff);
  }
  consentedRows(session: string, since: number, cutoff: number): SummaryRow[] {
    return this.database
      .prepare(
        `SELECT m.actor,m.text FROM messages m JOIN actors_private a ON a.id=m.actor
      JOIN viewer_consents c ON c.session=m.session AND c.platform=m.platform AND c.channel=m.channel AND c.author=a.author
      WHERE m.session=? AND m.hidden=0 AND m.platform<>'experiment' AND c.granted=1 AND m.received>? AND m.seq>?
      ORDER BY m.seq DESC LIMIT 300`,
      )
      .all(session, since, cutoff)
      .map((row) => ({ actor: String(row.actor), text: String(row.text) }));
  }
  dependencies(session: string): MessageDependency[] {
    return this.database
      .prepare(
        `SELECT m.id AS messageId,m.reply AS sourceId FROM messages m
      WHERE m.session=? AND m.platform='experiment' AND m.reply IS NOT NULL
      UNION SELECT m.id AS messageId,c.source_message_id AS sourceId FROM messages m
      JOIN ai_message_context c ON c.message_id=m.id WHERE m.session=? AND m.platform='experiment'`,
      )
      .all(session, session)
      .map((row) => ({
        messageId: String(row.messageId),
        sourceId: String(row.sourceId),
      }));
  }
  hasMessage(session: string, id: string, visibleOnly: boolean) {
    return !!this.database
      .prepare(
        "SELECT 1 FROM messages WHERE session=? AND id=? AND (?=0 OR hidden=0)",
      )
      .get(session, id, visibleOnly ? 1 : 0);
  }
  participantMessages(
    session: string,
    platform: string,
    channel: string,
    author: string,
  ) {
    return this.database
      .prepare(
        "SELECT m.id FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.platform=? AND m.channel=? AND a.author=?",
      )
      .all(session, platform, channel, author)
      .map((row) => String(row.id));
  }
  eraseMessage(session: string, id: string, now: number) {
    this.database
      .prepare("UPDATE messages SET hidden=1,text='' WHERE session=? AND id=?")
      .run(session, id);
    const event = this.database
      .prepare(
        "INSERT INTO events(session,type,target,at,payload) VALUES(?,'message.hidden',?,?,'null')",
      )
      .run(session, id, now);
    this.database
      .prepare(
        "DELETE FROM ai_message_context WHERE (message_id=? OR source_message_id=?) AND message_id IN (SELECT id FROM messages WHERE session=?)",
      )
      .run(id, id, session);
    return Number(event.lastInsertRowid);
  }
  pruneIdentities(session: string) {
    this.database
      .prepare(
        "DELETE FROM actors_private WHERE session=? AND id NOT IN (SELECT actor FROM messages WHERE hidden=0)",
      )
      .run(session);
    const remaining = new Set(
      this.database
        .prepare("SELECT id FROM actors_private WHERE session=?")
        .all(session)
        .map((row) => String(row.id)),
    );
    const events = this.database
      .prepare(
        "SELECT seq,payload FROM events WHERE session=? AND type='identity.revealed'",
      )
      .all(session);
    for (const event of events) {
      const identities = identitiesSchema
        .parse(JSON.parse(String(event.payload)))
        .filter((identity) => remaining.has(identity.actorId));
      this.database
        .prepare("UPDATE events SET payload=? WHERE seq=?")
        .run(JSON.stringify(identities), event.seq);
    }
  }
  clearAttemptContext(session: string) {
    this.database
      .prepare(
        `UPDATE persona_reaction_attempts SET result=NULL,model_manifest=NULL,event_ids='[]',
      state=CASE WHEN state IN ('generating','candidate','dispatching') THEN 'canceled' ELSE state END,
      reason='chat_context_removed' WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?)`,
      )
      .run(session);
  }
  cancelPendingAttempts(session: string, now: number) {
    this.database
      .prepare(
        `UPDATE persona_reaction_attempts SET state='canceled',reason='chat_context_removed',result=NULL,model_manifest=NULL,finished_at=?
      WHERE session_id IN (SELECT id FROM persona_sessions WHERE source_session=?) AND state IN ('generating','candidate','dispatching')`,
      )
      .run(now, session);
  }
  recordDependencies(messageId: string, sourceIds: string[]) {
    const insert = this.database.prepare(
      "INSERT OR IGNORE INTO ai_message_context VALUES(?,?)",
    );
    for (const id of sourceIds) insert.run(messageId, id);
  }
  audit(
    session: string,
    action: "message.hidden" | "chat_summary.cleared",
    now: number,
  ) {
    this.database
      .prepare("INSERT INTO audit_events(session,at,action) VALUES(?,?,?)")
      .run(session, now, action);
  }
}
