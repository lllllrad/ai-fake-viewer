import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type {
  CastDispatch,
  CastDispatchInput,
} from "../../application/reactions/dispatch.ts";
import { dispatchAllowed } from "../../domain/reactions/dispatch.ts";
import { policySchema } from "../../contracts/cast-configuration.ts";
export class SqliteCastDispatch implements CastDispatch {
  constructor(
    private readonly database: DatabaseSync,
    private readonly runtime: {
      sessionId(): string;
      closed(): boolean;
      now(): number;
      transaction<T>(work: () => T): T;
    },
  ) {}
  claim(input: CastDispatchInput) {
    try {
      return this.runtime.transaction(() => this.claimCurrent(input));
    } catch {
      return false;
    }
  }
  private claimCurrent({
    sessionId,
    memberId,
    sessionEpoch,
    memberEpoch,
    attemptId,
  }: CastDispatchInput) {
    if (this.runtime.closed()) return false;
    const broadcast = this.runtime.sessionId();
    const s = this.database
      .prepare("SELECT * FROM persona_sessions WHERE id=?")
      .get(sessionId);
    const m = this.database
      .prepare("SELECT * FROM persona_cast WHERE session_id=? AND member_id=?")
      .get(sessionId, memberId);
    const a = this.database
      .prepare("SELECT * FROM persona_reaction_attempts WHERE id=?")
      .get(attemptId);
    if (
      !s ||
      !m ||
      !a ||
      s.source_session !== broadcast ||
      s.state !== "live" ||
      !s.armed ||
      s.control_epoch !== sessionEpoch ||
      m.status !== "present" ||
      m.muted ||
      m.epoch !== memberEpoch ||
      a.state !== "candidate" ||
      a.session_id !== sessionId ||
      a.member_id !== memberId ||
      a.session_epoch !== sessionEpoch ||
      a.member_epoch !== memberEpoch ||
      a.definition_hash !== m.definition_hash ||
      a.config_revision !== s.revision
    )
      return false;
    const policy = policySchema.parse(JSON.parse(String(s.policy))),
      now = this.runtime.now();
    const count = (sql: string, ...params: (string | number)[]) =>
      Number(this.database.prepare(sql).get(...params)!.n);
    const upstream = count(
      "SELECT COUNT(*) n FROM messages WHERE session=? AND platform<>'experiment' AND hidden=0 AND received>=?",
      broadcast,
      now - policy.rolling_window_ms,
    );
    const synthetic = count(
      "SELECT COUNT(*) n FROM messages WHERE session=? AND platform='experiment' AND hidden=0 AND received>=?",
      broadcast,
      now - policy.rolling_window_ms,
    );
    const reservations = count(
      "SELECT COUNT(*) n FROM persona_reaction_attempts WHERE session_id=? AND state IN ('generating','candidate','dispatching') AND started_at>=?",
      sessionId,
      now - policy.rolling_window_ms,
    );
    const globalGapCount = count(
      "SELECT COUNT(*) n FROM messages WHERE session=? AND platform='experiment' AND received>=?",
      broadcast,
      now - policy.minimum_global_gap_ms,
    );
    const memberCooldownCount = count(
      "SELECT COUNT(*) n FROM persona_reaction_attempts WHERE session_id=? AND member_id=? AND state='published' AND finished_at>=?",
      sessionId,
      memberId,
      now - policy.persona_cooldown_ms,
    );
    const inflight = count(
      "SELECT COUNT(*) n FROM persona_reaction_attempts WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
      sessionId,
    );
    const latestAuthors = this.database
      .prepare(
        "SELECT a.author FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.session=? AND m.platform='experiment' AND m.hidden=0 ORDER BY m.seq DESC LIMIT ?",
      )
      .all(broadcast, policy.max_consecutive_messages_from_one_persona)
      .map((row) => String(row.author));
    const eventIds = z.array(z.string()).parse(JSON.parse(String(a.event_ids)));
    const missing = count(
      `SELECT COUNT(*) n FROM json_each(?) e
      WHERE NOT EXISTS(SELECT 1 FROM messages m WHERE m.id=e.value AND m.session=? AND m.hidden=0)
        AND NOT EXISTS(SELECT 1 FROM transcripts t WHERE t.id=e.value AND t.session=?)`,
      JSON.stringify(eventIds),
      broadcast,
      broadcast,
    );
    const result = z
      .object({ text: z.string() })
      .safeParse(JSON.parse(String(a.result ?? "null")));
    if (!result.success) return false;
    const priorTexts = this.database
      .prepare(
        "SELECT m.text FROM messages m JOIN actors_private p ON p.id=m.actor WHERE m.session=? AND p.author LIKE 'persona-%' AND m.hidden=0 AND m.received>=?",
      )
      .all(broadcast, now - 120000)
      .map((row) => String(row.text));
    if (
      !dispatchAllowed(policy, {
        upstream,
        synthetic,
        reservations,
        globalGapCount,
        memberCooldownCount,
        inflight,
        latestAuthors,
        memberAuthor: "persona-" + memberId,
        evidenceAvailable: missing === 0,
        proposed: result.data.text,
        priorTexts,
      })
    )
      return false;
    return (
      this.database
        .prepare(
          "UPDATE persona_reaction_attempts SET state='dispatching' WHERE id=? AND state='candidate'",
        )
        .run(attemptId).changes === 1
    );
  }
}
