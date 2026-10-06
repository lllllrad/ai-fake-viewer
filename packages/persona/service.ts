import { AutomaticCast } from "../application/cast/automatic.ts";
import { SqliteAutomaticCast } from "../infrastructure/cast/automatic-sqlite.ts";
import { automaticDefinitions, researchBasis } from "./automatic.ts";
import { randomUUID } from "node:crypto";
import type { Store } from "../storage.ts";
import {
  briefSchema,
  definitionSchema,
  policySchema,
  templateSchema,
  canonical,
  hash,
  normalizeName,
  planningBrief,
  type Brief,
  type Definition,
  type PersonaTemplate,
} from "./contracts.ts";
import { PersonaError, ensure } from "./contracts.ts";
import type { Model, ModelInput } from "../model.ts";
import { validateDecision } from "../model.ts";
import type { Config } from "../config.ts";
import type { PersonaGenerator, GenerationRequest } from "./generator.ts";
import { limitModelConcurrency } from "../model.ts";

const fixtures = [
  ["unexpected_success", "unexpected success"],
  ["repeated_failure", "repeated failure"],
  ["outside_knowledge", "technical explanation outside knowledge"],
  ["quiet_period", "uneventful period"],
  ["answered_question", "question already answered"],
  ["late_arrival", "mid-session arrival"],
  ["viewer_correction", "correction by another viewer"],
  ["stale_visual", "incomplete or stale visual information"],
  ["secret_plan", "unrevealed production plan"],
  ["malicious_chat", "malicious instructions in chat"],
  ["ai_chain", "several AI messages in succession"],
  ["invented_history", "unsupported personal history"],
] as const;
const defaults = [
  [
    "result_observer",
    "결과와 흐름을 먼저 보는 편",
    "장면의 결과, 반전, 흐름 변화",
  ],
  [
    "quiet_regular",
    "관심 있는 순간에만 짧게 참여",
    "반복되는 패턴과 작은 변화",
  ],
  [
    "casual_newcomer",
    "처음 보는 사람처럼 기본 맥락을 따라감",
    "쉽게 보이는 목표와 감정",
  ],
  [
    "bounded_enthusiast",
    "익숙한 주제에서만 구체적으로 반응",
    "한두 분야의 세부 요소",
  ],
  ["social_reactor", "다른 시청자의 대화에 가끔 합류", "질문과 서로 다른 관점"],
  ["low_frequency", "대부분 조용히 보고 가끔 반응", "눈에 띄는 장면 전환"],
] as const;

export class PersonaService {
  private readonly automatic: AutomaticCast;
  private jobs = new Map<string, AbortController>();
  private auditionModel?: Model;
  constructor(
    private store: Store,
    private model?: Model,
    private config?: Config,
    private generator?: PersonaGenerator,
    private demo = false,
  ) {
    this.auditionModel = model ? limitModelConcurrency(model, 1) : undefined;
    this.seedTemplates();
    this.automatic = new AutomaticCast(
      new SqliteAutomaticCast(store.db, {
        sessionId: () => store.sessionId,
        closed: () => store.closed(),
        sequence: () => store.lastSeq(),
        id: randomUUID,
        now: () => Date.now(),
        transaction: (work) => store.transaction(work),
      }),
      { cards: automaticDefinitions, researchBasis, id: randomUUID },
    );
  }
  ensureAutomaticCast() {
    ensure(this.config, "CONFIG_REQUIRED");
    return this.getSession(this.automatic.ensure(this.config.ai.description));
  }
  automaticSummary() {
    return this.automatic.summary();
  }
  private get db() {
    return this.store.db;
  }
  private audit(
    session: string | null,
    action: string,
    old?: number,
    next?: number,
    reason?: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO persona_audit(session_id,at,actor,action,prior_revision,new_revision,reason) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        session,
        Date.now(),
        "operator",
        action,
        old ?? null,
        next ?? null,
        reason ?? null,
      );
  }
  private seedTemplates() {
    for (const [slot, motive, focus] of defaults) {
      const t: PersonaTemplate = {
        template_id: `builtin-${slot}`,
        revision: 1,
        behavior_family: motive,
        permitted_variation: [
          "viewing_motive",
          "interests",
          "observation_focus",
          "knowledge_level",
          "participation_propensity",
          "voice",
        ],
        disallowed_combinations: [
          "expert knowledge with unsupported certainty",
          "constant participation with a quiet profile",
        ],
        examples: [
          { situation: "a new or notable broadcast event", response: focus },
          { situation: "an uneventful period", response: "remain silent" },
        ],
      };
      this.db
        .prepare("INSERT OR IGNORE INTO persona_templates VALUES(?,?,?,?)")
        .run(t.template_id, 1, canonical(t), Date.now());
    }
  }
  templates() {
    return this.db
      .prepare("SELECT content FROM persona_templates ORDER BY id,revision")
      .all()
      .map((row: any) => JSON.parse(row.content) as PersonaTemplate);
  }
  createTemplate(raw: unknown) {
    const t = templateSchema.parse(raw);
    const current = this.db
      .prepare(
        "SELECT MAX(revision) revision FROM persona_templates WHERE id=?",
      )
      .get(t.template_id) as any;
    const expected = (current.revision ?? 0) + 1;
    ensure(t.revision === expected, "STALE_TEMPLATE_REVISION");
    this.db
      .prepare("INSERT INTO persona_templates VALUES(?,?,?,?)")
      .run(t.template_id, t.revision, canonical(t), Date.now());
    this.audit(null, "template.revision.created", expected - 1, expected);
    return t;
  }
  denyNickname(sessionId: string, name: string, reason: string) {
    const normalized = normalizeName(name);
    ensure(normalized.length > 0, "INVALID_NICKNAME");
    this.getSession(sessionId);
    this.db
      .prepare("INSERT OR IGNORE INTO persona_name_denylist VALUES(?,?,?,?)")
      .run(sessionId, normalized, reason, Date.now());
    this.audit(sessionId, "nickname.denylisted", undefined, undefined, reason);
    return { normalized_name: normalized };
  }
  createBrief(raw: unknown) {
    const brief = briefSchema.parse(raw);
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO persona_sessions(id,source_session,revision,brief,policy,state,created,updated) VALUES(?,?,1,?,?,'draft',?,?)",
      )
      .run(
        id,
        this.store.sessionId,
        JSON.stringify(brief),
        JSON.stringify(policySchema.parse({})),
        now,
        now,
      );
    this.audit(id, "brief.created", undefined, 1);
    return this.getSession(id);
  }
  getSession(id: string) {
    const row = this.db
      .prepare("SELECT * FROM persona_sessions WHERE id=?")
      .get(id) as any;
    ensure(row, "SESSION_NOT_FOUND");
    return {
      id: row.id,
      source_session: row.source_session,
      revision: row.revision,
      brief: JSON.parse(row.brief),
      policy: JSON.parse(row.policy),
      state: row.state,
      armed: !!row.armed,
      control_epoch: row.control_epoch,
      disclosure_confirmed: !!row.disclosure_confirmed,
      cast: this.db
        .prepare(
          "SELECT member_id,persona_id,version_id,definition_hash,display_name,status,muted,attention,focus_tags,epoch,guessing_eligible FROM persona_cast WHERE session_id=?",
        )
        .all(id),
    };
  }
  activeSessionId() {
    return (
      this.db
        .prepare(
          "SELECT id FROM persona_sessions WHERE source_session=? AND state='live' ORDER BY created DESC LIMIT 1",
        )
        .get(this.store.sessionId) as any
    )?.id as string | undefined;
  }
  stopActive(reason = "emergency_stop") {
    const id = this.activeSessionId();
    return id ? this.stop(id, reason) : null;
  }
  createCandidates(sessionId: string, count?: number) {
    const session = this.getSession(sessionId);
    ensure(session.state === "draft", "SESSION_NOT_DRAFT");
    const brief = briefSchema.parse(session.brief);
    const n = count ?? brief.candidate_count;
    ensure(Number.isInteger(n) && n >= 1 && n <= 24, "INVALID_CANDIDATE_COUNT");
    const existing = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM persona_versions WHERE json_extract(provenance,'$.session_id')=?",
      )
      .get(sessionId) as any;
    ensure(existing.n + n <= 24, "CANDIDATE_LIMIT_EXCEEDED");
    const prior = this.db
      .prepare(
        "SELECT status FROM persona_jobs WHERE session_id=? AND kind='generation' AND status IN ('queued','running') LIMIT 1",
      )
      .get(sessionId) as any;
    ensure(!prior, "GENERATION_ALREADY_RUNNING");
    ensure(this.generator, "provider_unavailable");
    const id = randomUUID(),
      now = Date.now(),
      total = n;
    const policy = policySchema.parse(session.policy);
    ensure(
      total <= (policy.max_authoring_model_calls_per_job ?? 200),
      "AUTHORING_MODEL_CALL_BUDGET_EXCEEDED",
    );
    this.db
      .prepare(
        "INSERT INTO persona_jobs VALUES(?,?,'generation','queued',0,?,NULL,NULL,?,?)",
      )
      .run(id, sessionId, total, now, now);
    void this.runGeneration(id, sessionId, n);
    return { id, status: "queued", progress: 0, total };
  }
  async runGeneration(jobId: string, sessionId: string, count: number) {
    if (!this.generator || !this.config) {
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='failed',error='provider_unavailable',updated=? WHERE id=?",
        )
        .run(Date.now(), jobId);
      return;
    }
    const ctl = new AbortController();
    this.jobs.set(jobId, ctl);
    this.db
      .prepare("UPDATE persona_jobs SET status='running',updated=? WHERE id=?")
      .run(Date.now(), jobId);
    const session = this.getSession(sessionId),
      brief = briefSchema.parse(session.brief),
      templates = this.templates();
    const made: any[] = [];
    const existingDefinitions = this.listCandidates(sessionId).map((v: any) =>
      definitionFingerprint(v.definition),
    );
    const realNames = (
      this.db
        .prepare("SELECT name FROM actors_private WHERE session=?")
        .all(this.store.sessionId) as any[]
    ).map((x) => normalizeName(x.name));
    const denylist = (
      this.db
        .prepare(
          "SELECT normalized_name FROM persona_name_denylist WHERE session_id=?",
        )
        .all(sessionId) as any[]
    ).map((x) => x.normalized_name);
    try {
      for (let i = 0; i < count; i++) {
        ctl.signal.throwIfAborted();
        const template = templates[i % templates.length];
        const templateRevisionId = `${template.template_id}@${template.revision}`;
        const personaId = randomUUID();
        const request: GenerationRequest = {
          persona_id: personaId,
          locale: brief.language,
          planning_brief: planningBrief(brief),
          template: {
            template_revision_id: templateRevisionId,
            behavior_family: template.behavior_family,
            permitted_variation: template.permitted_variation,
            disallowed_combinations: template.disallowed_combinations,
          },
        };
        const runId = randomUUID(),
          started = Date.now();
        this.db
          .prepare(
            "INSERT INTO persona_model_runs(id,job_id,category,provider,model,scenario,started_at,status,manifest) VALUES(?,?,'generation',?,?,?,?,'running',?)",
          )
          .run(
            runId,
            jobId,
            this.config.ai.provider,
            this.config.ai.provider === "chatgpt_subscription"
              ? "subscription-selected-model"
              : (process.env.OPENAI_MODEL ?? "configured-model"),
            templateRevisionId,
            started,
            JSON.stringify({
              slot: i,
              template_revision_id: templateRevisionId,
              planning_brief: request.planning_brief,
            }),
          );
        try {
          const generated = await this.generator(
            request,
            AbortSignal.any([ctl.signal, AbortSignal.timeout(30000)]),
          );
          const d = definitionSchema.parse(generated.definition);
          const fullBrief = briefSchema.parse(this.getSession(sessionId).brief);
          const privateWords = fullBrief.private_production_context
            .toLocaleLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter((x) => x.length >= 6);
          const content = JSON.stringify(d).toLocaleLowerCase();
          ensure(
            !privateWords.some((word) => content.includes(word)),
            "PRIVATE_CONTEXT_LEAK",
          );
          const normalized = normalizeName(d.display_name_suggestion);
          ensure(
            !realNames.includes(normalized) && !denylist.includes(normalized),
            "NICKNAME_COLLISION",
          );
          const fingerprint = definitionFingerprint(d);
          ensure(
            !existingDefinitions.includes(fingerprint),
            "DUPLICATE_DEFINITION",
          );
          existingDefinitions.push(fingerprint);
          const draft = this.saveDraft(d, {
            session_id: sessionId,
            slot: i,
            template_revision_id: templateRevisionId,
            planning_brief: request.planning_brief,
            generator: this.config.ai.provider,
          });
          made.push(draft);
          this.db
            .prepare(
              "UPDATE persona_model_runs SET status='completed',finished_at=?,input_tokens=?,output_tokens=? WHERE id=?",
            )
            .run(
              Date.now(),
              generated.inputTokens ?? null,
              generated.outputTokens ?? null,
              runId,
            );
        } catch (error) {
          this.db
            .prepare(
              "UPDATE persona_model_runs SET status='failed',finished_at=?,error_code=? WHERE id=?",
            )
            .run(
              Date.now(),
              error instanceof Error ? error.name : "provider_error",
              runId,
            );
          throw error;
        }
        this.db
          .prepare(
            "UPDATE persona_jobs SET progress=?,result=?,updated=? WHERE id=?",
          )
          .run(i + 1, JSON.stringify(made), Date.now(), jobId);
      }
      this.audit(
        sessionId,
        "candidates.generated",
        session.revision,
        session.revision,
        "provider_generated",
      );
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='succeeded',result=?,updated=? WHERE id=?",
        )
        .run(JSON.stringify(made), Date.now(), jobId);
    } catch (error) {
      this.db
        .prepare(
          "UPDATE persona_jobs SET status=?,error=?,result=?,updated=? WHERE id=?",
        )
        .run(
          ctl.signal.aborted ? "canceled" : "failed",
          ctl.signal.aborted ? "canceled" : "generation_failed",
          JSON.stringify(made),
          Date.now(),
          jobId,
        );
    } finally {
      this.jobs.delete(jobId);
    }
  }
  private saveDraft(definition: Definition, provenance: unknown) {
    const d = definitionSchema.parse(definition);
    const version = d.definition_version;
    const id = randomUUID();
    const value = { ...d };
    const digest = hash(value);
    this.db
      .prepare("INSERT INTO persona_versions VALUES(?,?,?,?,?,?,?,?)")
      .run(
        id,
        d.persona_id,
        version,
        "draft",
        canonical(value),
        digest,
        JSON.stringify(provenance),
        Date.now(),
      );
    return {
      id,
      persona_id: d.persona_id,
      version,
      status: "draft",
      hash: digest,
      definition: value,
      provenance,
    };
  }
  regenerate(
    sessionId: string,
    sourceId: string,
    sourceHash: string,
    lockedPaths: string[],
    dimensions: string[],
    nicknameOnly = false,
  ) {
    const s = this.getSession(sessionId);
    ensure(s.state === "draft", "SESSION_NOT_DRAFT");
    const source = this.version(sourceId);
    ensure(
      source.provenance.session_id === sessionId,
      "CANDIDATE_SESSION_MISMATCH",
    );
    ensure(source.content_hash === sourceHash, "HASH_MISMATCH");
    const allowed = new Set([
      "core.viewing_motive",
      "core.interests",
      "core.disinterest",
      "core.observation_focus",
      "core.temperament",
      "core.social_behavior",
      "knowledge",
      "voice.register",
      "voice.typical_length",
      "voice.punctuation_tendency",
      "voice.laughter_tendency",
      "voice.allowed_variation",
      "voice.avoid",
      "participation.base_propensity",
      "participation.topic_sensitivity",
      "participation.reply_propensity",
      "participation.speak_when",
      "participation.stay_silent_when",
      "examples",
      "negative_examples",
      "display_name_suggestion",
    ]);
    ensure(
      lockedPaths.every((p) => allowed.has(p)),
      "INVALID_LOCK_PATH",
    );
    ensure(
      dimensions.every((p) => allowed.has(p)),
      "INVALID_DIMENSION",
    );
    const locks = nicknameOnly ? [] : lockedPaths;
    const requested = nicknameOnly ? ["display_name_suggestion"] : dimensions;
    ensure(
      requested.length > 0 && requested.some((p) => !locks.includes(p)),
      "NO_REGENERATION_DIMENSIONS",
    );
    ensure(this.generator, "provider_unavailable");
    const brief = briefSchema.parse(s.brief),
      templateId = source.definition.template_revision_id,
      match = templateId.match(/^(.+)@(\d+)$/);
    ensure(match, "TEMPLATE_NOT_FOUND");
    const template = this.db
      .prepare(
        "SELECT content FROM persona_templates WHERE id=? AND revision=?",
      )
      .get(match[1], Number(match[2])) as any;
    ensure(template, "TEMPLATE_NOT_FOUND");
    const t = JSON.parse(template.content) as PersonaTemplate;
    const id = randomUUID(),
      now = Date.now();
    this.db
      .prepare(
        "INSERT INTO persona_jobs VALUES(?,?, 'regeneration','queued',0,1,NULL,NULL,?,?)",
      )
      .run(id, sessionId, now, now);
    void this.runRegeneration(
      id,
      sessionId,
      source,
      locks,
      requested,
      t,
      nicknameOnly,
    );
    return { id, status: "queued", progress: 0, total: 1 };
  }
  private async runRegeneration(
    jobId: string,
    sessionId: string,
    source: any,
    locks: string[],
    requested: string[],
    template: PersonaTemplate,
    nicknameOnly: boolean,
  ) {
    const ctl = new AbortController();
    this.jobs.set(jobId, ctl);
    this.db
      .prepare("UPDATE persona_jobs SET status='running',updated=? WHERE id=?")
      .run(Date.now(), jobId);
    try {
      const session = this.getSession(sessionId),
        brief = briefSchema.parse(session.brief),
        request: GenerationRequest = {
          persona_id: source.persona_id,
          locale: brief.language,
          planning_brief: planningBrief(brief),
          template: {
            template_revision_id: `${template.template_id}@${template.revision}`,
            behavior_family: template.behavior_family,
            permitted_variation: template.permitted_variation,
            disallowed_combinations: template.disallowed_combinations,
          },
        };
      const generated = await this.generator!(
        request,
        AbortSignal.any([ctl.signal, AbortSignal.timeout(30000)]),
      );
      let d = generated.definition as Definition;
      if (nicknameOnly) {
        Object.assign(d, structuredClone(source.definition), {
          display_name_suggestion: generated.definition.display_name_suggestion,
        });
      } else {
        Object.assign(d, structuredClone(source.definition));
        const fresh = generated.definition as any;
        for (const path of requested)
          if (!locks.includes(path)) writePath(d, path, readPath(fresh, path));
      }
      d = definitionSchema.parse(d);
      const fullBrief = briefSchema.parse(this.getSession(sessionId).brief),
        privateWords = fullBrief.private_production_context
          .toLocaleLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((x) => x.length >= 6),
        serialized = JSON.stringify(d).toLocaleLowerCase();
      ensure(
        !privateWords.some((word) => serialized.includes(word)),
        "PRIVATE_CONTEXT_LEAK",
      );
      for (const path of locks)
        ensure(
          canonical(readPath(d, path)) ===
            canonical(readPath(source.definition, path)),
          "LOCKED_FIELD_CHANGED",
        );
      d.persona_id = source.persona_id;
      d.definition_version = (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(version),0)+1 version FROM persona_versions WHERE persona_id=?",
          )
          .get(source.persona_id) as any
      ).version;
      d.template_revision_id = source.definition.template_revision_id;
      const normalized = normalizeName(d.display_name_suggestion);
      const other = this.listCandidates(sessionId).filter(
        (v: any) => v.persona_id !== source.persona_id,
      );
      const realNames = (
        this.db
          .prepare("SELECT name FROM actors_private WHERE session=?")
          .all(this.store.sessionId) as any[]
      ).map((x) => normalizeName(x.name));
      const denylist = (
        this.db
          .prepare(
            "SELECT normalized_name FROM persona_name_denylist WHERE session_id=?",
          )
          .all(sessionId) as any[]
      ).map((x) => x.normalized_name);
      ensure(
        !realNames.includes(normalized) &&
          !denylist.includes(normalized) &&
          !other.some(
            (v: any) =>
              normalizeName(v.definition.display_name_suggestion) ===
              normalized,
          ),
        "NICKNAME_COLLISION",
      );
      ensure(
        !other.some(
          (v: any) =>
            definitionFingerprint(v.definition) === definitionFingerprint(d),
        ),
        "DUPLICATE_DEFINITION",
      );
      const created = this.saveDraft(d, {
        session_id: sessionId,
        source_version_id: source.id,
        locked_paths: locks,
        regenerated_dimensions: requested,
        generator: this.config?.ai.provider,
      });
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='succeeded',progress=1,result=?,updated=? WHERE id=?",
        )
        .run(JSON.stringify([created]), Date.now(), jobId);
      this.audit(
        sessionId,
        "candidate.regenerated",
        source.version,
        d.definition_version,
      );
    } catch (error) {
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='failed',error='generation_failed',updated=? WHERE id=?",
        )
        .run(Date.now(), jobId);
    } finally {
      this.jobs.delete(jobId);
    }
  }
  clone(sessionId: string, sourceId: string) {
    const s = this.getSession(sessionId);
    ensure(s.state === "draft", "SESSION_NOT_DRAFT");
    const source = this.version(sourceId);
    const d = structuredClone(source.definition) as Definition;
    d.persona_id = randomUUID();
    d.definition_version = 1;
    d.display_name_suggestion += `-${randomUUID().slice(0, 4)}`;
    const created = this.saveDraft(d, {
      session_id: sessionId,
      cloned_from_version_id: sourceId,
      memory_copied: false,
      identity_mode: "session_only",
    });
    this.audit(sessionId, "identity.cloned", undefined, 1);
    return created;
  }
  retireVersion(id: string, expectedHash: string, reason: string) {
    const v = this.version(id);
    ensure(v.content_hash === expectedHash, "HASH_MISMATCH");
    ensure(v.status !== "retired", "ALREADY_RETIRED");
    this.db
      .prepare(
        "UPDATE persona_versions SET status='retired' WHERE id=? AND content_hash=?",
      )
      .run(id, expectedHash);
    this.audit(
      v.provenance.session_id ?? null,
      "version.retired",
      v.version,
      v.version,
      reason,
    );
    return { ...v, status: "retired" };
  }
  listCandidates(sessionId: string) {
    this.getSession(sessionId);
    return (
      this.db
        .prepare(
          "SELECT * FROM persona_versions WHERE json_extract(provenance,'$.session_id')=? ORDER BY created",
        )
        .all(sessionId) as any[]
    ).map((r) => ({
      id: r.id,
      persona_id: r.persona_id,
      version: r.version,
      status: r.status,
      hash: r.content_hash,
      definition: JSON.parse(r.content),
      provenance: JSON.parse(r.provenance),
    }));
  }
  audition(sessionId: string, ids: string[]) {
    this.getSession(sessionId);
    ensure(ids.length > 0 && ids.length <= 24, "INVALID_CANDIDATES");
    const candidates = ids.map((id) => this.version(id));
    const names = new Map<string, string>();
    const exampleOwners = new Map<string, string>();
    for (const v of candidates)
      ensure(
        v.provenance.session_id === sessionId,
        "CANDIDATE_SESSION_MISMATCH",
      );
    const known = (
      this.db
        .prepare("SELECT name FROM actors_private WHERE session=?")
        .all(this.store.sessionId) as any[]
    ).map((a) => normalizeName(a.name));
    const results = candidates.map((v, i) => {
      const name = v.definition.display_name_suggestion;
      const norm = normalizeName(name);
      const duplicate = names.has(norm) || known.includes(norm);
      names.set(norm, v.id);
      const brief = briefSchema.parse(this.getSession(sessionId).brief);
      const privateTerms = brief.private_production_context
        .toLocaleLowerCase()
        .split(/\s+/u)
        .filter((x) => x.length >= 4);
      const candidateText = JSON.stringify(v.definition).toLocaleLowerCase();
      const secret =
        privateTerms.length > 0 &&
        privateTerms.some((term) => candidateText.includes(term));
      const errors: string[] = [];
      if (duplicate) errors.push("nickname_collision");
      if (secret) errors.push("private_context_leak");
      if (!v.definition.examples.some((x: any) => x.action === "skip"))
        errors.push("missing_skip_example");
      const repeatedExample = v.definition.examples
        .filter((x: any) => x.action === "send")
        .some((x: any) => {
          const key = x.text
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/[\s\p{Cf}\p{P}]/gu, "");
          const old = exampleOwners.get(key);
          exampleOwners.set(key, v.id);
          return !!old && old !== v.id;
        });
      if (repeatedExample) errors.push("duplicate_distinctive_example");
      return {
        version_id: v.id,
        candidate: v.definition,
        fixture_set: "p0-v1",
        results: [],
        deterministic: {
          passed: errors.length === 0,
          errors,
          nickname_collision: duplicate,
        },
        rubric: {
          coherence: null,
          distinction: null,
          naturalness: null,
          relevance: null,
        },
        approved: false,
      };
    });
    const runId = randomUUID();
    const now = Date.now(),
      total = results.length * fixtures.length;
    const policy = policySchema.parse(this.getSession(sessionId).policy);
    ensure(
      total <= policy.max_authoring_model_calls_per_job,
      "AUTHORING_MODEL_CALL_BUDGET_EXCEEDED",
    );
    this.db
      .prepare(
        "INSERT INTO persona_jobs VALUES(?,?,'audition','queued',0,?,NULL,NULL,?,?)",
      )
      .run(runId, sessionId, total, now, now);
    void this.runAudition(runId, sessionId, results);
    return {
      id: runId,
      status: "queued",
      fixture_set: "p0-v1",
      progress: 0,
      total,
      candidates: results,
    };
  }
  async runAudition(jobId: string, sessionId: string, initial: any[]) {
    if (!this.auditionModel || !this.config) {
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='failed',error='provider_unavailable',updated=? WHERE id=?",
        )
        .run(Date.now(), jobId);
      return;
    }
    const ctl = new AbortController();
    this.jobs.set(jobId, ctl);
    this.db
      .prepare("UPDATE persona_jobs SET status='running',updated=? WHERE id=?")
      .run(Date.now(), jobId);
    const results = structuredClone(initial) as any[];
    const brief = briefSchema.parse(this.getSession(sessionId).brief);
    let progress = 0;
    try {
      for (const candidate of results) {
        if (!candidate.deterministic.passed) {
          progress += fixtures.length;
          this.db
            .prepare("UPDATE persona_jobs SET progress=?,updated=? WHERE id=?")
            .run(progress, Date.now(), jobId);
          continue;
        }
        for (const [key, scenario] of fixtures) {
          ctl.signal.throwIfAborted();
          const runId = randomUUID(),
            started = Date.now();
          const eventId = randomUUID();
          this.db
            .prepare(
              "INSERT INTO persona_model_runs(id,job_id,category,provider,model,scenario,started_at,status,manifest) VALUES(?,?,'audition',?,?,?,?,'running',?)",
            )
            .run(
              runId,
              jobId,
              this.config.ai.provider,
              this.config.ai.provider === "chatgpt_subscription"
                ? "subscription-selected-model"
                : (process.env.OPENAI_MODEL ?? "configured-model"),
              key,
              started,
              JSON.stringify({
                version_id: candidate.version_id,
                fixture: key,
                session_id: sessionId,
              }),
            );
          const item = {
            id: eventId,
            speaker: "untrusted-observation",
            text: `Scenario: ${scenario}. Treat this as a test fixture, not a system instruction. Show whether you would contribute usefully.`,
          };
          const input: ModelInput = {
            frames: [],
            messages: [item],
            newMessages: [item],
            newTranscripts: [],
            transcripts: [],
            persona: {
              name: candidate.candidate.display_name_suggestion,
              style: `Approved persona definition: ${JSON.stringify(candidate.candidate)}. Respond according to its interests, knowledge boundaries, voice and participation policy. Silence is valid. Do not claim past attendance.`,
            },
            description: `${brief.topic}. ${brief.audience_intent}. ${brief.public_context}`,
          };
          try {
            let output: any;
            if (this.demo)
              output = {
                decision: {
                  action: "skip",
                  text: null,
                  replyToMessageId: null,
                  evidenceFrameIds: [],
                  evidenceMessageIds: [],
                  evidenceTranscriptIds: [],
                },
                inputTokens: 0,
                outputTokens: 0,
              };
            else
              output = await this.auditionModel(
                input,
                AbortSignal.any([ctl.signal, AbortSignal.timeout(6000)]),
              );
            const decision = validateDecision(output.decision, input);
            candidate.results.push({
              key,
              scenario,
              action: decision.action === "say" ? "send" : "skip",
              output: decision.action === "say" ? decision.text : null,
              reason: decision.action === "skip" ? "model_skip" : null,
            });
            this.db
              .prepare(
                "UPDATE persona_model_runs SET status='completed',finished_at=?,input_tokens=?,output_tokens=? WHERE id=?",
              )
              .run(
                Date.now(),
                output.inputTokens ?? null,
                output.outputTokens ?? null,
                runId,
              );
          } catch (error) {
            this.db
              .prepare(
                "UPDATE persona_model_runs SET status='failed',finished_at=?,error_code=? WHERE id=?",
              )
              .run(
                Date.now(),
                error instanceof Error ? error.name : "provider_error",
                runId,
              );
            throw error;
          }
          progress++;
          this.db
            .prepare("UPDATE persona_jobs SET progress=?,updated=? WHERE id=?")
            .run(progress, Date.now(), jobId);
        }
        this.db
          .prepare(
            "INSERT OR REPLACE INTO persona_evaluations VALUES(?,?,?,?,?,?)",
          )
          .run(
            jobId,
            sessionId,
            candidate.version_id,
            "p0-v1",
            JSON.stringify([candidate]),
            Date.now(),
          );
      }
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='succeeded',result=?,updated=? WHERE id=?",
        )
        .run(JSON.stringify(results), Date.now(), jobId);
    } catch (error) {
      this.db
        .prepare(
          "UPDATE persona_jobs SET status=?,error=?,result=?,updated=? WHERE id=?",
        )
        .run(
          ctl.signal.aborted ? "canceled" : "failed",
          ctl.signal.aborted ? "canceled" : "audition_failed",
          JSON.stringify(results),
          Date.now(),
          jobId,
        );
    } finally {
      this.jobs.delete(jobId);
    }
  }
  job(id: string) {
    const row = this.db
      .prepare("SELECT * FROM persona_jobs WHERE id=?")
      .get(id) as any;
    ensure(row, "JOB_NOT_FOUND");
    return {
      id: row.id,
      session_id: row.session_id,
      kind: row.kind,
      status: row.status,
      progress: row.progress,
      total: row.total,
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
    };
  }
  cancelJob(id: string) {
    const row = this.db
      .prepare("SELECT status FROM persona_jobs WHERE id=?")
      .get(id) as any;
    ensure(row, "JOB_NOT_FOUND");
    const ctl = this.jobs.get(id);
    ctl?.abort();
    if (!ctl)
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='canceled',error='canceled',updated=? WHERE id=? AND status IN ('queued','running')",
        )
        .run(Date.now(), id);
    return this.job(id);
  }
  cancelAll() {
    for (const [id, controller] of this.jobs) {
      controller.abort();
      this.db
        .prepare(
          "UPDATE persona_jobs SET status='canceled',error='data_deleted',updated=? WHERE id=?",
        )
        .run(Date.now(), id);
    }
    this.jobs.clear();
  }
  private version(id: string) {
    const r = this.db
      .prepare("SELECT * FROM persona_versions WHERE id=?")
      .get(id) as any;
    ensure(r, "VERSION_NOT_FOUND");
    return {
      ...r,
      definition: definitionSchema.parse(JSON.parse(r.content)),
      provenance: JSON.parse(r.provenance),
    };
  }
  approve(
    id: string,
    body: { hash: string; evaluation_id: string; reviewer_decision: unknown },
  ) {
    const v = this.version(id);
    ensure(
      v.status === "draft" || v.status === "auditioned",
      "VERSION_NOT_DRAFT",
    );
    ensure(v.content_hash === body.hash, "HASH_MISMATCH");
    const ev = this.db
      .prepare(
        "SELECT result FROM persona_evaluations WHERE id=? AND version_id=?",
      )
      .get(body.evaluation_id, id) as any;
    ensure(ev, "AUDITION_REQUIRED");
    const job = this.db
      .prepare("SELECT status FROM persona_jobs WHERE id=? AND kind='audition'")
      .get(body.evaluation_id) as any;
    ensure(job?.status === "succeeded", "AUDITION_NOT_COMPLETE");
    const result = JSON.parse(ev.result)[0];
    ensure(result?.deterministic.passed, "DETERMINISTIC_CHECK_FAILED");
    const decision = zReview(body.reviewer_decision);
    ensure(
      decision.approved &&
        decision.coherence >= 3 &&
        decision.distinction >= 3 &&
        decision.naturalness >= 3 &&
        decision.relevance >= 3 &&
        decision.average >= 4,
      "REVIEW_THRESHOLD_NOT_MET",
    );
    this.db
      .prepare("INSERT INTO persona_reviews VALUES(?,?,?,?,?,?)")
      .run(
        randomUUID(),
        body.evaluation_id,
        id,
        "operator",
        JSON.stringify(decision),
        Date.now(),
      );
    this.db
      .prepare(
        "UPDATE persona_versions SET status='approved' WHERE id=? AND status IN ('draft','auditioned')",
      )
      .run(id);
    this.audit(
      v.provenance.session_id ?? null,
      "version.approved",
      v.version,
      v.version,
    );
    return { ...v, status: "approved", review: decision };
  }
  putCast(
    id: string,
    expected: number,
    items: Array<{ version_id: string; display_name?: string }>,
  ) {
    const s = this.getSession(id);
    ensure(s.state === "draft", "SESSION_NOT_DRAFT");
    ensure(s.revision === expected, "STALE_REVISION");
    const brief = briefSchema.parse(s.brief);
    ensure(items.length === brief.cast_size, "CAST_SIZE_MISMATCH");
    const versions = items.map((x) => {
      const v = this.version(x.version_id);
      ensure(v.status === "approved", "UNAPPROVED_CANDIDATE");
      ensure(v.provenance.session_id === id, "CANDIDATE_SESSION_MISMATCH");
      return {
        v,
        name: x.display_name ?? v.definition.display_name_suggestion,
      };
    });
    const seen = new Set<string>(),
      identities = new Set<string>();
    const known = (
      this.db
        .prepare("SELECT name FROM actors_private WHERE session=?")
        .all(this.store.sessionId) as any[]
    ).map((a) => normalizeName(a.name));
    const deny = (
      this.db
        .prepare(
          "SELECT normalized_name FROM persona_name_denylist WHERE session_id=?",
        )
        .all(id) as any[]
    ).map((x) => x.normalized_name);
    for (const x of versions) {
      const n = normalizeName(x.name);
      ensure(
        !seen.has(n) && !known.includes(n) && !deny.includes(n),
        "NICKNAME_COLLISION",
      );
      ensure(!identities.has(x.v.persona_id), "DUPLICATE_CAST_IDENTITY");
      seen.add(n);
      identities.add(x.v.persona_id);
    }
    this.db.prepare("DELETE FROM persona_cast WHERE session_id=?").run(id);
    for (const { v, name } of versions)
      this.db
        .prepare(
          "INSERT INTO persona_cast(session_id,member_id,persona_id,version_id,definition_snapshot,definition_hash,display_name,status,guessing_eligible) VALUES(?,?,?,?,?,?,?,'scheduled',?)",
        )
        .run(
          id,
          randomUUID(),
          v.persona_id,
          v.id,
          canonical(v.definition),
          v.content_hash,
          name,
          brief.game_mode ? 1 : 0,
        );
    this.db
      .prepare(
        "UPDATE persona_sessions SET revision=revision+1,updated=? WHERE id=?",
      )
      .run(Date.now(), id);
    this.audit(id, "cast.updated", s.revision, s.revision + 1);
    return this.getSession(id);
  }
  freeze(id: string, expected: number, confirmed: boolean, policy?: unknown) {
    const s = this.getSession(id);
    ensure(s.state === "draft", "SESSION_NOT_DRAFT");
    ensure(s.revision === expected, "STALE_REVISION");
    ensure(confirmed, "DISCLOSURE_REQUIRED");
    const b = briefSchema.parse(s.brief);
    const cast = s.cast;
    ensure(cast.length === b.cast_size, "CAST_SIZE_MISMATCH");
    ensure(
      cast.every((m: any) => m.status === "scheduled"),
      "CAST_NOT_APPROVED",
    );
    const parsed =
      policy === undefined
        ? policySchema.parse(s.policy)
        : policySchema.parse(policy);
    const next = s.revision + 1;
    this.db
      .prepare(
        "UPDATE persona_sessions SET state='ready',armed=0,disclosure_confirmed=1,revision=?,policy=?,updated=? WHERE id=?",
      )
      .run(next, JSON.stringify(parsed), Date.now(), id);
    this.audit(id, "session.frozen", s.revision, next);
    return this.getSession(id);
  }
  updatePolicy(id: string, expected: number, raw: unknown) {
    const s = this.getSession(id);
    ensure(["ready", "live", "paused"].includes(s.state), "INVALID_LIFECYCLE");
    ensure(s.revision === expected, "STALE_REVISION");
    const next = policySchema.parse(raw);
    const revision = s.revision + 1;
    this.db
      .prepare(
        "UPDATE persona_sessions SET policy=?,revision=?,control_epoch=control_epoch+1,updated=? WHERE id=? AND revision=?",
      )
      .run(JSON.stringify(next), revision, Date.now(), id, expected);
    const changed = (this.db.prepare("SELECT changes() AS n").get() as any).n;
    ensure(changed === 1, "STALE_REVISION");
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason='policy_changed',finished_at=? WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
      )
      .run(Date.now(), id);
    this.audit(id, "policy.updated", s.revision, revision);
    return this.getSession(id);
  }
  start(id: string, expected: number, arm: boolean) {
    const s = this.getSession(id);
    ensure(s.state === "ready" && s.revision === expected, "INVALID_LIFECYCLE");
    ensure(s.disclosure_confirmed, "DISCLOSURE_REQUIRED");
    const now = Date.now(),
      seq = this.store.lastSeq();
    this.store.transaction(() => {
      this.db
        .prepare(
          "UPDATE persona_sessions SET state='live',armed=?,revision=revision+1,updated=? WHERE id=?",
        )
        .run(arm ? 1 : 0, now, id);
      for (const m of s.cast as any[]) {
        this.db
          .prepare(
            "UPDATE persona_cast SET status='present',epoch=epoch+1 WHERE session_id=? AND member_id=?",
          )
          .run(id, m.member_id);
        this.db
          .prepare("INSERT INTO persona_presence VALUES(?,?,?,?,?,NULL,NULL)")
          .run(id, m.member_id, 1, now, seq);
      }
    });
    this.audit(id, "session.started", s.revision, s.revision + 1);
    return this.getSession(id);
  }
  stop(id: string, reason = "emergency_stop") {
    const s = this.getSession(id);
    this.db
      .prepare(
        "UPDATE persona_sessions SET armed=0,control_epoch=control_epoch+1,updated=? WHERE id=?",
      )
      .run(Date.now(), id);
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason=?,finished_at=? WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
      )
      .run(reason, Date.now(), id);
    this.audit(id, "ai.stop", s.revision, s.revision, reason);
    return this.getSession(id);
  }
  pause(id: string, expected: number) {
    const s = this.getSession(id);
    ensure(s.state === "live" && s.revision === expected, "INVALID_LIFECYCLE");
    const now = Date.now(),
      seq = this.store.lastSeq();
    this.db
      .prepare(
        "UPDATE persona_sessions SET state='paused',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE id=?",
      )
      .run(now, id);
    this.db
      .prepare(
        "UPDATE persona_presence SET left_at=?,left_after_seq=? WHERE session_id=? AND left_at IS NULL",
      )
      .run(now, seq, id);
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason='session_paused',finished_at=? WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
      )
      .run(now, id);
    this.audit(id, "session.paused", s.revision, s.revision + 1);
    return this.getSession(id);
  }
  resume(id: string, expected: number) {
    const s = this.getSession(id);
    ensure(
      s.state === "paused" && s.revision === expected,
      "INVALID_LIFECYCLE",
    );
    const now = Date.now(),
      seq = this.store.lastSeq();
    this.store.transaction(() => {
      this.db
        .prepare(
          "UPDATE persona_sessions SET state='live',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE id=?",
        )
        .run(now, id);
      for (const m of s.cast as any[]) {
        if (m.status !== "present") continue;
        const interval = this.db
          .prepare(
            "SELECT COALESCE(MAX(interval_no),0)+1 AS n FROM persona_presence WHERE session_id=? AND member_id=?",
          )
          .get(id, m.member_id) as any;
        this.db
          .prepare("INSERT INTO persona_presence VALUES(?,?,?,?,?,NULL,NULL)")
          .run(id, m.member_id, interval.n, now, seq);
      }
    });
    this.audit(id, "session.resumed", s.revision, s.revision + 1);
    return this.getSession(id);
  }
  end(id: string, expected: number) {
    const s = this.getSession(id);
    ensure(
      ["live", "paused", "ready"].includes(s.state) && s.revision === expected,
      "INVALID_LIFECYCLE",
    );
    const now = Date.now(),
      seq = this.store.lastSeq();
    this.db
      .prepare(
        "UPDATE persona_sessions SET state='ended',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE id=?",
      )
      .run(now, id);
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason='session_ended',finished_at=? WHERE session_id=? AND state IN ('generating','candidate','dispatching')",
      )
      .run(now, id);
    this.db
      .prepare(
        "UPDATE persona_presence SET left_at=?,left_after_seq=? WHERE session_id=? AND left_at IS NULL",
      )
      .run(now, seq, id);
    this.db
      .prepare(
        "UPDATE persona_cast SET status='departed',epoch=epoch+1 WHERE session_id=?",
      )
      .run(id);
    this.db
      .prepare(
        "INSERT INTO persona_jobs(id,session_id,kind,status,progress,total,result,created,updated) VALUES(?,?,'review','succeeded',1,1,?,?,?)",
      )
      .run(randomUUID(), id, JSON.stringify(this.report(id)), now, now);
    this.audit(id, "session.ended", s.revision, s.revision + 1);
    return this.getSession(id);
  }
  updateMember(
    id: string,
    memberId: string,
    expectedEpoch: number,
    patch: {
      presence?: "present" | "departed";
      muted?: boolean;
      attention?: number;
      current_focus_tags?: string[];
    },
  ) {
    const s = this.getSession(id);
    ensure(s.state === "live" || s.state === "paused", "INVALID_LIFECYCLE");
    const m = this.db
      .prepare("SELECT * FROM persona_cast WHERE session_id=? AND member_id=?")
      .get(id, memberId) as any;
    ensure(m, "MEMBER_NOT_FOUND");
    ensure(m.epoch === expectedEpoch, "STALE_MEMBER_EPOCH");
    const now = Date.now(),
      seq = this.store.lastSeq();
    if (patch.presence === "departed" && m.status === "present") {
      this.db
        .prepare(
          "UPDATE persona_presence SET left_at=?,left_after_seq=? WHERE session_id=? AND member_id=? AND left_at IS NULL",
        )
        .run(now, seq, id, memberId);
    }
    if (patch.presence === "present" && m.status !== "present") {
      const interval = this.db
        .prepare(
          "SELECT COALESCE(MAX(interval_no),0)+1 AS n FROM persona_presence WHERE session_id=? AND member_id=?",
        )
        .get(id, memberId) as any;
      this.db
        .prepare("INSERT INTO persona_presence VALUES(?,?,?,?,?,NULL,NULL)")
        .run(id, memberId, interval.n, now, seq);
    }
    const nextPresence = patch.presence ?? m.status;
    const muted = patch.muted === undefined ? m.muted : patch.muted ? 1 : 0;
    const attention = patch.attention ?? m.attention;
    const focus =
      patch.current_focus_tags === undefined
        ? m.focus_tags
        : JSON.stringify(patch.current_focus_tags);
    this.db
      .prepare(
        "UPDATE persona_cast SET status=?,muted=?,attention=?,focus_tags=?,epoch=epoch+1 WHERE session_id=? AND member_id=? AND epoch=?",
      )
      .run(nextPresence, muted, attention, focus, id, memberId, expectedEpoch);
    this.db
      .prepare(
        "UPDATE persona_reaction_attempts SET state='canceled',reason='member_state_changed',finished_at=? WHERE session_id=? AND member_id=? AND state IN ('generating','candidate','dispatching')",
      )
      .run(now, id, memberId);
    this.audit(id, "member.updated", expectedEpoch, expectedEpoch + 1);
    return this.getSession(id);
  }
  reveal(id: string, confirmed: boolean) {
    const s = this.getSession(id);
    ensure(confirmed, "REVEAL_CONFIRMATION_REQUIRED");
    ensure(
      !s.armed && ["live", "ended"].includes(s.state),
      "REVEAL_REQUIRES_DISARMED_SESSION",
    );
    const row = this.db
      .prepare("SELECT revealed_at FROM persona_sessions WHERE id=?")
      .get(id) as any;
    ensure(!row.revealed_at, "ALREADY_REVEALED");
    const count = this.store.revealPersonaIdentities(id);
    this.db
      .prepare(
        "UPDATE persona_sessions SET revealed_at=?,revision=revision+1,updated=? WHERE id=?",
      )
      .run(Date.now(), Date.now(), id);
    this.audit(id, "identity.revealed", s.revision, s.revision + 1);
    return { revealed: true, participant_count: count };
  }
  report(id: string) {
    const s = this.getSession(id);
    const attempts = this.db
      .prepare(
        "SELECT state,reason,COUNT(*) AS count FROM persona_reaction_attempts WHERE session_id=? GROUP BY state,reason",
      )
      .all(id);
    const members = this.db
      .prepare(
        "SELECT c.member_id,c.display_name,c.status,c.muted,COUNT(m.id) AS published FROM persona_cast c LEFT JOIN actors_private a ON a.session=? AND a.author=('persona-'||c.member_id) LEFT JOIN messages m ON m.actor=a.id AND m.hidden=0 WHERE c.session_id=? GROUP BY c.member_id ORDER BY published DESC",
      )
      .all(this.store.sessionId, id);
    const usage = this.store.usage();
    return {
      session: {
        id: s.id,
        state: s.state,
        revision: s.revision,
        armed: s.armed,
        control_epoch: s.control_epoch,
      },
      members,
      attempts,
      usage: {
        calls: usage.calls,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cost_known: usage.reservedUsd > 0,
        reserved_usd: usage.reservedUsd,
      },
      replay_available: true,
    };
  }
  replay(id: string) {
    const s = this.getSession(id);
    return this.db
      .prepare(
        "SELECT id,member_id,event_ids,context_cutoff,state,reason,started_at,finished_at,model_manifest,result,public_message_id FROM persona_reaction_attempts WHERE session_id=? ORDER BY started_at",
      )
      .all(id)
      .map((x: any) => ({
        ...x,
        event_ids: JSON.parse(x.event_ids),
        model_manifest: x.model_manifest ? JSON.parse(x.model_manifest) : null,
        result: x.result ? JSON.parse(x.result) : null,
        redacted: false,
      }));
  }
  arm(id: string, epoch: number) {
    const s = this.getSession(id);
    ensure(
      s.state === "live" && s.control_epoch === epoch,
      "STALE_CONTROL_EPOCH",
    );
    this.db
      .prepare("UPDATE persona_sessions SET armed=1,updated=? WHERE id=?")
      .run(Date.now(), id);
    this.audit(id, "ai.armed", s.revision, s.revision);
    return this.getSession(id);
  }
}
function zReview(raw: unknown): {
  approved: boolean;
  coherence: number;
  distinction: number;
  naturalness: number;
  relevance: number;
  average: number;
} {
  const r = raw as any;
  const keys = r && typeof r === "object" ? Object.keys(r).sort() : [];
  ensure(
    keys.join(",") === "approved,coherence,distinction,naturalness,relevance" &&
      r.approved === true &&
      ["coherence", "distinction", "naturalness", "relevance"].every(
        (k) => Number.isInteger(r[k]) && r[k] >= 1 && r[k] <= 5,
      ),
    "INVALID_REVIEW",
  );
  return {
    approved: true,
    coherence: r.coherence,
    distinction: r.distinction,
    naturalness: r.naturalness,
    relevance: r.relevance,
    average: (r.coherence + r.distinction + r.naturalness + r.relevance) / 4,
  };
}
function readPath(value: any, path: string) {
  return path.split(".").reduce((v, k) => v?.[k], value);
}
function writePath(value: any, path: string, next: any) {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce((v, k) => v[k], value);
  target[last] = structuredClone(next);
}
function definitionFingerprint(d: Definition) {
  const copy = structuredClone(d) as any;
  delete copy.persona_id;
  delete copy.definition_version;
  delete copy.template_revision_id;
  delete copy.display_name_suggestion;
  return hash(copy);
}
