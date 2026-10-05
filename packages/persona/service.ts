import { randomUUID } from 'node:crypto';
import type { Store } from '../storage.ts';
import {
  briefSchema, definitionSchema, policySchema, canonical, hash, normalizeName,
  planningBrief, type Brief, type Definition,
} from './contracts.ts';
import { PersonaError, ensure } from './contracts.ts';

const fixtures = [
  ['unexpected_success', 'unexpected success'], ['repeated_failure', 'repeated failure'],
  ['outside_knowledge', 'technical explanation outside knowledge'], ['quiet_period', 'uneventful period'],
  ['answered_question', 'question already answered'], ['late_arrival', 'mid-session arrival'],
  ['viewer_correction', 'correction by another viewer'], ['stale_visual', 'incomplete or stale visual information'],
  ['secret_plan', 'unrevealed production plan'], ['malicious_chat', 'malicious instructions in chat'],
  ['ai_chain', 'several AI messages in succession'], ['invented_history', 'unsupported personal history'],
] as const;
const defaults = [
  ['result_observer', '결과와 흐름을 먼저 보는 편', '장면의 결과, 반전, 흐름 변화'],
  ['quiet_regular', '관심 있는 순간에만 짧게 참여', '반복되는 패턴과 작은 변화'],
  ['casual_newcomer', '처음 보는 사람처럼 기본 맥락을 따라감', '쉽게 보이는 목표와 감정'],
  ['bounded_enthusiast', '익숙한 주제에서만 구체적으로 반응', '한두 분야의 세부 요소'],
  ['social_reactor', '다른 시청자의 대화에 가끔 합류', '질문과 서로 다른 관점'],
  ['low_frequency', '대부분 조용히 보고 가끔 반응', '눈에 띄는 장면 전환'],
] as const;

export function defaultDefinition(personaId = randomUUID(), displayName = '새 시청자', slot = '관찰자'): Definition {
  return definitionSchema.parse({
    schema_version: 1, persona_id: personaId, definition_version: 1, template_revision_id: 'builtin-v1', locale: 'ko-KR', display_name_suggestion: displayName,
    core: { viewing_motive: `${slot}로서 방송을 편하게 즐긴다.`, interests: ['방송의 주제와 진행 흐름'], disinterest: ['맥락 없는 반복'], observation_focus: ['장면에서 실제로 바뀐 점'], temperament: '상황에 따라 반응하며 과장하지 않는다.', social_behavior: '다른 사람의 말을 존중하고 근거가 없으면 단정하지 않는다.' },
    knowledge: [{ topic: '방송 주제', level: 'basic', boundary: '설명되지 않은 전문 내용은 모른다고 말하거나 조용히 있는다.' }],
    voice: { register: '편한 한국어', typical_length: 'short', punctuation_tendency: '자연스럽고 간결하게 쓴다.', laughter_tendency: '필요할 때만 가볍게 웃는다.', allowed_variation: ['짧은 감탄', '구체적인 관찰'], avoid: ['같은 유행어 반복', '훈계'] },
    participation: { base_propensity: 0.3, topic_sensitivity: 0.6, reply_propensity: 0.2, speak_when: ['새로운 장면이나 분명한 변화가 있을 때'], stay_silent_when: ['이미 충분히 답변된 질문', '정보가 불확실할 때'] },
    examples: [{ situation: '분명한 결과가 나옴', action: 'send', text: '오, 여기서 결과가 갈렸네.' }, { situation: '잘 모르는 전문 용어', action: 'skip' }, { situation: '좋아하는 주제의 전개', action: 'send', text: '방금 선택이 흐름 바꾼 듯.' }, { situation: '잠시 조용한 구간', action: 'skip' }],
    negative_examples: [{ situation: '방송 시작 전 사건', unacceptable_behavior: '직접 봤다고 주장하기' }, { situation: '숨겨진 제작 계획', unacceptable_behavior: '미리 알고 있는 듯 말하기' }],
  });
}

export class PersonaService {
  constructor(private store: Store) {}
  private get db() { return this.store.db; }
  private audit(session: string | null, action: string, old?: number, next?: number, reason?: string) {
    this.db.prepare('INSERT INTO persona_audit(session_id,at,actor,action,prior_revision,new_revision,reason) VALUES(?,?,?,?,?,?,?)').run(session, Date.now(), 'operator', action, old ?? null, next ?? null, reason ?? null);
  }
  createBrief(raw: unknown) {
    const brief = briefSchema.parse(raw); const id = randomUUID(); const now = Date.now();
    this.db.prepare('INSERT INTO persona_sessions(id,source_session,revision,brief,policy,state,created,updated) VALUES(?,?,1,?,?,\'draft\',?,?)').run(id, this.store.sessionId, JSON.stringify(brief), JSON.stringify(policySchema.parse({})), now, now);
    this.audit(id, 'brief.created', undefined, 1); return this.getSession(id);
  }
  getSession(id: string) {
    const row = this.db.prepare('SELECT * FROM persona_sessions WHERE id=?').get(id) as any;
    ensure(row, 'SESSION_NOT_FOUND');
    return { id: row.id, source_session: row.source_session, revision: row.revision, brief: JSON.parse(row.brief), policy: JSON.parse(row.policy), state: row.state, armed: !!row.armed, control_epoch: row.control_epoch, disclosure_confirmed: !!row.disclosure_confirmed, cast: this.db.prepare('SELECT member_id,persona_id,version_id,definition_hash,display_name,status,muted,epoch,guessing_eligible FROM persona_cast WHERE session_id=?').all(id) };
  }
  createCandidates(sessionId: string, count?: number) {
    const session = this.getSession(sessionId); ensure(session.state === 'draft', 'SESSION_NOT_DRAFT');
    const brief = briefSchema.parse(session.brief); const n = count ?? brief.candidate_count;
    ensure(Number.isInteger(n) && n >= 1 && n <= 24, 'INVALID_CANDIDATE_COUNT');
    const existing = this.db.prepare('SELECT COUNT(*) AS n FROM persona_versions WHERE json_extract(provenance,\'$.session_id\')=?').get(sessionId) as any;
    ensure(existing.n + n <= 24, 'CANDIDATE_LIMIT_EXCEEDED');
    const made = [] as any[];
    for (let i=0;i<n;i++) {
      const [slot, motive, focus] = defaults[i % defaults.length]; const d=defaultDefinition(randomUUID(), `시청자${i+1}`, focus);
      d.core.viewing_motive = `${motive}. ${d.core.viewing_motive}`; d.core.observation_focus = [focus];
      d.participation.base_propensity = i < 2 ? 0.55 : i > 8 ? 0.15 : 0.3;
      made.push(this.saveDraft(d, { session_id: sessionId, slot, planning_brief: planningBrief(brief), generator: 'built-in-template-v1' }));
    }
    this.audit(sessionId, 'candidates.generated', session.revision, session.revision, 'rule_based');
    return { planning: defaults.slice(0, Math.min(n, defaults.length)).map(([slot,motive,focus])=>({slot,motive,focus})), candidates: made };
  }
  private saveDraft(definition: Definition, provenance: unknown) {
    const d=definitionSchema.parse(definition); const id=randomUUID(); const value={...d,definition_version:1}; const digest=hash(value);
    this.db.prepare('INSERT INTO persona_versions VALUES(?,?,?,?,?,?,?,?)').run(id,d.persona_id,1,'draft',canonical(value),digest,JSON.stringify(provenance),Date.now());
    return {id,persona_id:d.persona_id,version:1,status:'draft',hash:digest,definition:value,provenance};
  }
  listCandidates(sessionId: string) {
    this.getSession(sessionId);
    return (this.db.prepare("SELECT * FROM persona_versions WHERE json_extract(provenance,'$.session_id')=? ORDER BY created").all(sessionId) as any[]).map(r=>({id:r.id,persona_id:r.persona_id,version:r.version,status:r.status,hash:r.content_hash,definition:JSON.parse(r.content),provenance:JSON.parse(r.provenance)}));
  }
  audition(sessionId: string, ids: string[]) {
    this.getSession(sessionId); ensure(ids.length>0 && ids.length<=24, 'INVALID_CANDIDATES');
    const candidates=ids.map(id=>this.version(id)); const names=new Map<string,string>();
    const known=(this.db.prepare('SELECT name FROM actors_private WHERE session=?').all(this.store.sessionId) as any[]).map(a=>normalizeName(a.name));
    const results=candidates.map((v,i)=>{
      const name=v.definition.display_name_suggestion; const norm=normalizeName(name); const duplicate=names.has(norm)||known.includes(norm); names.set(norm,v.id);
      const brief=briefSchema.parse(this.getSession(sessionId).brief);
      const privateTerms=brief.private_production_context.toLocaleLowerCase().split(/\s+/u).filter(x=>x.length>=4);
      const candidateText=JSON.stringify(v.definition).toLocaleLowerCase();
      const secret=privateTerms.length>0 && privateTerms.some(term=>candidateText.includes(term));
      const errors:string[]=[]; if(duplicate) errors.push('nickname_collision'); if(secret) errors.push('private_context_leak');
      if(!v.definition.examples.some((x:any)=>x.action==='skip')) errors.push('missing_skip_example');
      return {version_id:v.id, candidate:v.definition, fixture_set:'p0-v1', results:fixtures.map(([key,scenario])=>({key,scenario,action:'review_required',output:null})), deterministic:{passed:errors.length===0,errors,nickname_collision:duplicate}, rubric:{coherence:null,distinction:null,naturalness:null,relevance:null}, approved:false};
    });
    const runId=randomUUID();
    for(const result of results) this.db.prepare('INSERT INTO persona_evaluations VALUES(?,?,?,?,?,?)').run(runId,sessionId,result.version_id,'p0-v1',JSON.stringify([result]),Date.now());
    return {id:runId,fixture_set:'p0-v1',candidates:results};
  }
  private version(id:string) { const r=this.db.prepare('SELECT * FROM persona_versions WHERE id=?').get(id) as any; ensure(r,'VERSION_NOT_FOUND'); return {...r,definition:definitionSchema.parse(JSON.parse(r.content)),provenance:JSON.parse(r.provenance)}; }
  approve(id:string, body:{hash:string;evaluation_id:string;reviewer_decision:unknown}) {
    const v=this.version(id); ensure(v.status==='draft'||v.status==='auditioned','VERSION_NOT_DRAFT'); ensure(v.content_hash===body.hash,'HASH_MISMATCH');
    const ev=this.db.prepare('SELECT result FROM persona_evaluations WHERE id=? AND version_id=?').get(body.evaluation_id,id) as any; ensure(ev,'AUDITION_REQUIRED');
    const result=JSON.parse(ev.result)[0]; ensure(result?.deterministic.passed,'DETERMINISTIC_CHECK_FAILED');
    const decision=zReview(body.reviewer_decision); ensure(decision.approved && decision.coherence>=3 && decision.distinction>=3 && decision.naturalness>=3 && decision.relevance>=3 && decision.average>=4,'REVIEW_THRESHOLD_NOT_MET');
    this.db.prepare("UPDATE persona_versions SET status='approved' WHERE id=? AND status IN ('draft','auditioned')").run(id);
    this.audit(v.provenance.session_id ?? null,'version.approved',v.version,v.version); return {...v,status:'approved',review:decision};
  }
  putCast(id:string, expected:number, items:Array<{version_id:string;display_name?:string}>) {
    const s=this.getSession(id); ensure(s.state==='draft','SESSION_NOT_DRAFT'); ensure(s.revision===expected,'STALE_REVISION'); const brief=briefSchema.parse(s.brief); ensure(items.length===brief.cast_size,'CAST_SIZE_MISMATCH');
    const versions=items.map(x=>{const v=this.version(x.version_id);ensure(v.status==='approved','UNAPPROVED_CANDIDATE');ensure(v.provenance.session_id===id,'CANDIDATE_SESSION_MISMATCH');return {v,name:x.display_name??v.definition.display_name_suggestion};});
    const seen=new Set<string>(); for(const x of versions){const n=normalizeName(x.name);ensure(!seen.has(n),'NICKNAME_COLLISION');seen.add(n);}
    this.db.prepare('DELETE FROM persona_cast WHERE session_id=?').run(id);
    for(const {v,name} of versions) this.db.prepare('INSERT INTO persona_cast(session_id,member_id,persona_id,version_id,definition_snapshot,definition_hash,display_name,status,guessing_eligible) VALUES(?,?,?,?,?,?,?,\'scheduled\',?)').run(id,randomUUID(),v.persona_id,v.id,canonical(v.definition),v.content_hash,name,brief.game_mode?1:0);
    this.db.prepare('UPDATE persona_sessions SET revision=revision+1,updated=? WHERE id=?').run(Date.now(),id); this.audit(id,'cast.updated',s.revision,s.revision+1); return this.getSession(id);
  }
  freeze(id:string, expected:number, confirmed:boolean, policy?:unknown) {
    const s=this.getSession(id);ensure(s.state==='draft','SESSION_NOT_DRAFT');ensure(s.revision===expected,'STALE_REVISION');ensure(confirmed,'DISCLOSURE_REQUIRED');const b=briefSchema.parse(s.brief);const cast=s.cast;ensure(cast.length===b.cast_size,'CAST_SIZE_MISMATCH');ensure(cast.every((m:any)=>m.status==='scheduled'),'CAST_NOT_APPROVED');
    const parsed=policy===undefined?policySchema.parse(s.policy):policySchema.parse(policy);const next=s.revision+1;
    this.db.prepare("UPDATE persona_sessions SET state='ready',armed=0,disclosure_confirmed=1,revision=?,policy=?,updated=? WHERE id=?").run(next,JSON.stringify(parsed),Date.now(),id);this.audit(id,'session.frozen',s.revision,next);return this.getSession(id);
  }
  start(id:string, expected:number, arm:boolean) { const s=this.getSession(id);ensure(s.state==='ready'&&s.revision===expected,'INVALID_LIFECYCLE');ensure(s.disclosure_confirmed,'DISCLOSURE_REQUIRED');ensure(!arm,'PERSONA_RUNTIME_NOT_CONNECTED');this.db.prepare("UPDATE persona_sessions SET state='live',armed=0,revision=revision+1,updated=? WHERE id=?").run(Date.now(),id);this.audit(id,'session.started',s.revision,s.revision+1,'runtime_not_connected');return this.getSession(id); }
  stop(id:string, reason='emergency_stop') { const s=this.getSession(id);this.db.prepare('UPDATE persona_sessions SET armed=0,control_epoch=control_epoch+1,updated=? WHERE id=?').run(Date.now(),id);this.audit(id,'ai.stop',s.revision,s.revision,reason);return this.getSession(id); }
  pause(id:string, expected:number) { const s=this.getSession(id);ensure(s.state==='live'&&s.revision===expected,'INVALID_LIFECYCLE');this.db.prepare("UPDATE persona_sessions SET state='paused',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE id=?").run(Date.now(),id);this.audit(id,'session.paused',s.revision,s.revision+1);return this.getSession(id); }
  resume(id:string, expected:number) { const s=this.getSession(id);ensure(s.state==='paused'&&s.revision===expected,'INVALID_LIFECYCLE');this.db.prepare("UPDATE persona_sessions SET state='live',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE id=?").run(Date.now(),id);this.audit(id,'session.resumed',s.revision,s.revision+1);return this.getSession(id); }
  end(id:string, expected:number) { const s=this.getSession(id);ensure(['live','paused','ready'].includes(s.state)&&s.revision===expected,'INVALID_LIFECYCLE');this.db.prepare("UPDATE persona_sessions SET state='ended',armed=0,control_epoch=control_epoch+1,revision=revision+1,updated=? WHERE id=?").run(Date.now(),id);this.audit(id,'session.ended',s.revision,s.revision+1);return this.getSession(id); }
  arm(id:string, epoch:number) { const s=this.getSession(id);ensure(s.state==='live'&&s.control_epoch===epoch,'STALE_CONTROL_EPOCH');throw new PersonaError('PERSONA_RUNTIME_NOT_CONNECTED'); }
}
function zReview(raw:unknown):{approved:boolean;coherence:number;distinction:number;naturalness:number;relevance:number;average:number} { const r=raw as any; ensure(r&&typeof r==='object'&&r.approved===true&&['coherence','distinction','naturalness','relevance'].every(k=>Number.isInteger(r[k])&&r[k]>=1&&r[k]<=5),'INVALID_REVIEW');return {...r,average:(r.coherence+r.distinction+r.naturalness+r.relevance)/4}; }
