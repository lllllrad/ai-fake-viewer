import type { DatabaseSync } from "node:sqlite";
import type {
  LocalPublication,
  PublicationRepository,
} from "../../application/reactions/publication-service.ts";
interface Attempt {
  session_id: string;
  member_id: string;
  session_epoch: number;
  member_epoch: number;
  definition_hash: string;
}
interface CastSession {
  source_session: string;
  state: string;
  armed: number;
  control_epoch: number;
}
interface Member {
  status: string;
  muted: number;
  epoch: number;
  definition_hash: string;
}
export class SqliteLocalPublication implements PublicationRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly runtime: {
      sessionId(): string;
      id(): string;
      now(): number;
    },
  ) {}
  write(input: LocalPublication) {
    const session = this.runtime.sessionId();
    const broadcast = this.database
      .prepare("SELECT closed FROM sessions WHERE id=?")
      .get(session);
    if (!broadcast || broadcast.closed !== null) return null;
    if (input.cast) {
      const attempt = this.database
        .prepare(
          "SELECT session_id,member_id,session_epoch,member_epoch,definition_hash FROM persona_reaction_attempts WHERE id=? AND state='dispatching'",
        )
        .get(input.cast.attemptId) as unknown as Attempt | undefined;
      if (!attempt || attempt.member_id !== input.cast.memberId) return null;
      const cast = this.database
        .prepare(
          "SELECT source_session,state,armed,control_epoch FROM persona_sessions WHERE id=?",
        )
        .get(attempt.session_id) as unknown as CastSession | undefined;
      const member = this.database
        .prepare(
          "SELECT status,muted,epoch,definition_hash FROM persona_cast WHERE session_id=? AND member_id=?",
        )
        .get(attempt.session_id, input.cast.memberId) as unknown as
        Member | undefined;
      if (
        !cast ||
        !member ||
        cast.source_session !== session ||
        cast.state !== "live" ||
        !cast.armed ||
        cast.control_epoch !== attempt.session_epoch ||
        member.status !== "present" ||
        member.muted ||
        member.epoch !== attempt.member_epoch ||
        member.definition_hash !== attempt.definition_hash
      )
        return null;
    }
    for (const id of input.sourceMessageIds)
      if (
        !this.database
          .prepare(
            "SELECT 1 FROM messages WHERE id=? AND session=? AND hidden=0",
          )
          .get(id, session)
      )
        return null;
    let actor = this.database
      .prepare(
        "SELECT id FROM actors_private WHERE session=? AND source='experiment' AND author=?",
      )
      .get(session, input.actor)?.id;
    if (!actor) {
      actor = this.runtime.id();
      this.database
        .prepare(
          "INSERT INTO actors_private(id,session,source,author,name) VALUES(?,?,'experiment',?,?)",
        )
        .run(actor, session, input.actor, input.name);
    }
    const id = this.runtime.id(),
      now = this.runtime.now();
    const sequence = Number(
      this.database
        .prepare(
          "INSERT INTO events(session,type,target,at,payload) VALUES(?,'message.added',?,?,'null')",
        )
        .run(session, id, now).lastInsertRowid,
    );
    this.database
      .prepare(
        "INSERT INTO messages(id,session,actor,platform,channel,source_id,published,received,text,reply,hidden,seq) VALUES(?,?,?,'experiment',?,?,?,?,?,?,0,?)",
      )
      .run(
        id,
        session,
        actor,
        session,
        input.cast?.attemptId ?? null,
        input.cast ? now : null,
        now,
        input.text,
        input.replyToId,
        sequence,
      );
    if (input.cast) {
      this.database
        .prepare(
          "INSERT OR IGNORE INTO persona_publication_outbox(message_id,attempt_id,state,created,dispatched) VALUES(?,?,'dispatched',?,?)",
        )
        .run(id, input.cast.attemptId, now, now);
      this.database
        .prepare(
          "UPDATE persona_reaction_attempts SET state='published',finished_at=?,public_message_id=? WHERE id=? AND state='dispatching'",
        )
        .run(now, id, input.cast.attemptId);
    }
    return { id, sequence };
  }
  recordSources(messageId: string, sourceIds: string[]) {
    const insert = this.database.prepare(
      "INSERT OR IGNORE INTO ai_message_context VALUES(?,?)",
    );
    for (const id of sourceIds) insert.run(messageId, id);
  }
}
