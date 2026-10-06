import type { DatabaseSync } from "node:sqlite";
import type { AuthorizedAudience } from "../../application/reactions/model-authorization.ts";
interface AudienceParticipant {
  id: string;
  epoch: number;
  author: string;
  platform: string;
  broadcaster: string;
}
export class SqliteModelAudience {
  constructor(
    private readonly db: DatabaseSync,
    private readonly source: {
      sessionId(): string;
      participants(): Iterable<AudienceParticipant>;
    },
  ) {}
  read(messageIds: string[]): AuthorizedAudience[] {
    if (!messageIds.length) return [];
    const rows = this.db
      .prepare(
        "SELECT a.author,m.platform,m.channel FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.hidden=0 AND m.id IN (SELECT value FROM json_each(?))",
      )
      .all(this.source.sessionId(), JSON.stringify(messageIds));
    const keys = new Set(
      rows.map((row) =>
        JSON.stringify([row.platform, row.channel, row.author]),
      ),
    );
    return [...this.source.participants()]
      .filter((participant) =>
        keys.has(
          JSON.stringify([
            participant.platform,
            participant.broadcaster,
            participant.author,
          ]),
        ),
      )
      .map((participant) => ({
        participantId: participant.id,
        epoch: participant.epoch,
      }));
  }
}
