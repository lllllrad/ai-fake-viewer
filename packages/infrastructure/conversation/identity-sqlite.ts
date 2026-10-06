import type { DatabaseSync } from "node:sqlite";
import type { IdentityRepository } from "../../application/conversation/identity-service.ts";
import {
  conversationIdentitySchema,
  type ConversationIdentity,
} from "../../contracts/conversation.ts";
export class SqliteConversationIdentities implements IdentityRepository {
  constructor(private readonly database: DatabaseSync) {}
  visible(sessionId: string, castId?: string): ConversationIdentity[] {
    const rows =
      castId === undefined
        ? this.database
            .prepare(
              "SELECT DISTINCT a.id,a.name,a.source FROM actors_private a JOIN messages m ON m.actor=a.id WHERE a.session=? AND m.session=? AND m.hidden=0",
            )
            .all(sessionId, sessionId)
        : this.database
            .prepare(
              "SELECT DISTINCT a.id,a.name,a.source FROM actors_private a JOIN messages m ON m.actor=a.id JOIN persona_cast c ON c.session_id=? AND a.author=('persona-'||c.member_id) WHERE a.session=? AND m.session=? AND m.hidden=0 AND m.platform='experiment'",
            )
            .all(castId, sessionId, sessionId);
    return rows.map((row) =>
      conversationIdentitySchema.parse({
        actorId: row.id,
        displayName: row.name,
        kind:
          row.source === "experiment"
            ? "system_generated"
            : "platform_received",
      }),
    );
  }
  disclose(sessionId: string, identities: ConversationIdentity[], at: number) {
    return Number(
      this.database
        .prepare(
          "INSERT INTO events(session,type,target,at,payload) VALUES(?,'identity.revealed',NULL,?,?)",
        )
        .run(sessionId, at, JSON.stringify(identities)).lastInsertRowid,
    );
  }
  disableAi() {
    this.database
      .prepare(
        "INSERT INTO runtime_flags(key,value) VALUES('ai_desired_running','0') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run();
  }
}
