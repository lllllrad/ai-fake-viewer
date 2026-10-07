import type { DatabaseSync } from "node:sqlite";
import type {
  AutomaticCard,
  AutomaticCastRepository,
} from "../../application/cast/automatic.ts";
import {
  briefSchema,
  policySchema,
  canonical,
  hash,
} from "../../persona/contracts.ts";
export class SqliteAutomaticCast implements AutomaticCastRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly runtime: {
      sessionId(): string;
      closed(): boolean;
      sequence(): number;
      id(): string;
      now(): number;
      transaction<T>(work: () => T): T;
    },
  ) {}
  transaction<T>(work: () => T) {
    return this.runtime.transaction(work);
  }
  closed() {
    return this.runtime.closed();
  }
  active() {
    const row = this.db
      .prepare(
        "SELECT id FROM persona_sessions WHERE source_session=? AND state='live' ORDER BY created DESC LIMIT 1",
      )
      .get(this.runtime.sessionId());
    return row ? String(row.id) : undefined;
  }
  viewerNames() {
    return this.db
      .prepare(
        "SELECT name FROM actors_private WHERE session=? AND source<>'experiment'",
      )
      .all(this.runtime.sessionId())
      .map((row) => String(row.name));
  }
  create(topic: string, cards: AutomaticCard[], researchBasis: string) {
    const id = this.runtime.id(),
      now = this.runtime.now(),
      sequence = this.runtime.sequence();
    const brief = briefSchema.parse({
      session_title: "자동 시청자",
      topic,
      audience_intent: "서로 다른 시청 동기로 현재 방송에 참여",
      public_context: topic,
      private_production_context: "",
      tone_policy: "신상·과거 이력·친분을 꾸며내지 않고 관찰 근거에 따라 반응",
      candidate_count: 6,
      cast_size: 6,
    });
    this.db
      .prepare(
        "INSERT INTO persona_sessions(id,source_session,revision,brief,policy,state,created,updated) VALUES(?,?,3,?,?,'live',?,?)",
      )
      .run(
        id,
        this.runtime.sessionId(),
        JSON.stringify(brief),
        JSON.stringify(policySchema.parse({})),
        now,
        now,
      );
    for (const card of cards) {
      const versionId = this.runtime.id(),
        memberId = this.runtime.id(),
        definition = card.definition;
      const content = canonical(definition),
        digest = hash(definition);
      const provenance = {
        session_id: id,
        generator: "automatic-research-composition",
        research_basis: researchBasis,
        sources: card.sources,
        ...(card.nickname ? { nickname: card.nickname } : {}),
        validation: "schema-and-unique-name",
        human_review: false,
      };
      this.db
        .prepare("INSERT INTO persona_versions VALUES(?,?,?,?,?,?,?,?)")
        .run(
          versionId,
          definition.persona_id,
          definition.definition_version,
          "approved",
          content,
          digest,
          JSON.stringify(provenance),
          now,
        );
      this.db
        .prepare(
          "INSERT INTO persona_cast(session_id,member_id,persona_id,version_id,definition_snapshot,definition_hash,display_name,status,epoch,guessing_eligible) VALUES(?,?,?,?,?,?,?,'present',1,1)",
        )
        .run(
          id,
          memberId,
          definition.persona_id,
          versionId,
          content,
          digest,
          definition.display_name_suggestion,
        );
      this.db
        .prepare("INSERT INTO persona_presence VALUES(?,?,?,?,?,NULL,NULL)")
        .run(id, memberId, 1, now, sequence);
    }
    this.db
      .prepare(
        "INSERT INTO persona_audit(session_id,at,actor,action,reason) VALUES(?,?,?,?,?)",
      )
      .run(id, now, "system", "cast.automatically_prepared", researchBasis);
    return id;
  }
  members() {
    const id = this.active();
    if (!id) return [];
    return this.db
      .prepare(
        "SELECT member_id,display_name,definition_snapshot FROM persona_cast WHERE session_id=?",
      )
      .all(id)
      .map((row) => ({
        id: String(row.member_id),
        name: String(row.display_name),
        definition: JSON.parse(String(row.definition_snapshot)) as unknown,
      }));
  }
}
