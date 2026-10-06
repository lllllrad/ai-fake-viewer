import type { DatabaseSync } from "node:sqlite";
import {
  castRuntimeSchema,
  castPresenceSchema,
  type CastRuntime,
} from "../../contracts/cast-runtime.ts";
export class SqliteCastRuntime {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sessionId: () => string,
  ) {}
  read(): CastRuntime | null {
    const broadcast = this.sessionId();
    const session = this.database
      .prepare(
        "SELECT s.id,s.revision,s.armed,s.control_epoch,s.policy,s.brief FROM persona_sessions s JOIN sessions b ON b.id=s.source_session WHERE s.source_session=? AND s.state='live' AND b.closed IS NULL ORDER BY s.created DESC,s.rowid DESC LIMIT 1",
      )
      .get(broadcast);
    if (!session) return null;
    const members = this.database
      .prepare(
        "SELECT * FROM persona_cast WHERE session_id=? AND status='present' AND muted=0 ORDER BY rowid",
      )
      .all(session.id);
    const lastSpoke = new Map(
      this.database
        .prepare(
          "SELECT a.author,MAX(m.received) AS at FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.hidden=0 GROUP BY a.author",
        )
        .all(broadcast)
        .map((row) => [String(row.author), Number(row.at)]),
    );
    const recent = this.database
      .prepare(
        "SELECT a.author FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.platform='experiment' AND m.hidden=0 ORDER BY m.seq DESC LIMIT 5",
      )
      .all(broadcast);
    const presence = new Map<
      string,
      ReturnType<typeof castPresenceSchema.parse>[]
    >();
    for (const row of this.database
      .prepare(
        "SELECT member_id,joined_after_seq,left_after_seq,joined_at,left_at FROM persona_presence WHERE session_id=? ORDER BY member_id,interval_no",
      )
      .all(session.id)) {
      const id = String(row.member_id),
        intervals = presence.get(id) ?? [];
      intervals.push(castPresenceSchema.parse(row));
      presence.set(id, intervals);
    }
    return castRuntimeSchema.parse({
      id: session.id,
      revision: session.revision,
      armed: !!session.armed,
      controlEpoch: session.control_epoch,
      configRevision: session.revision,
      policy: JSON.parse(String(session.policy)),
      brief: JSON.parse(String(session.brief)),
      members: members.map((member) => {
        const author = `persona-${member.member_id}`;
        let consecutive = 0;
        for (const row of recent) {
          if (row.author !== author) break;
          consecutive++;
        }
        return {
          id: member.member_id,
          personaId: member.persona_id,
          versionId: member.version_id,
          snapshot: JSON.parse(String(member.definition_snapshot)),
          hash: member.definition_hash,
          displayName: member.display_name,
          epoch: member.epoch,
          attention: member.attention,
          focusTags: JSON.parse(String(member.focus_tags)),
          guessingEligible: !!member.guessing_eligible,
          lastPublishedAt: lastSpoke.get(author) ?? null,
          consecutiveMessages: consecutive,
          presence: presence.get(String(member.member_id)) ?? [],
        };
      }),
    });
  }
}
