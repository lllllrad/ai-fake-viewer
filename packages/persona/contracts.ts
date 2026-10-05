import { z } from 'zod';
import { createHash } from 'node:crypto';
const text = z.string().trim().min(1).max(1000);
const strings = z.array(text).max(20);
const probability = z.number().min(0).max(1);
export const exampleSchema = z.discriminatedUnion('action', [
  z.object({ situation: text, action: z.literal('send'), text }).strict(),
  z.object({ situation: text, action: z.literal('skip') }).strict(),
]);
export const definitionSchema = z.object({
  schema_version: z.literal(1), persona_id: z.string().uuid(), definition_version: z.number().int().positive(),
  template_revision_id: text, locale: text, display_name_suggestion: z.string().trim().min(1).max(60),
  core: z.object({ viewing_motive: text, interests: strings.min(1), disinterest: strings.min(1), observation_focus: strings.min(1), temperament: text, social_behavior: text }).strict(),
  knowledge: z.array(z.object({ topic: text, level: z.enum(['unfamiliar','basic','intermediate','expert']), boundary: text }).strict()).min(1).max(12),
  voice: z.object({ register: text, typical_length: z.enum(['very_short','short','mixed']), punctuation_tendency: text, laughter_tendency: text, allowed_variation: strings, avoid: strings }).strict(),
  participation: z.object({ base_propensity: probability, topic_sensitivity: probability, reply_propensity: probability, speak_when: strings.min(1), stay_silent_when: strings.min(1) }).strict(),
  examples: z.array(exampleSchema).min(4).max(12).refine(v => v.some(e => e.action === 'skip'), 'A skip example is required'),
  negative_examples: z.array(z.object({ situation: text, unacceptable_behavior: text }).strict()).min(2).max(10),
}).strict();
export type Definition = z.infer<typeof definitionSchema>;
export const briefSchema = z.object({
  session_title: text, topic: text, audience_intent: text, public_context: z.string().max(4000), private_production_context: z.string().max(4000),
  language: z.string().min(2).max(30).default('ko-KR'), tone_policy: text, cast_mode: z.literal('fresh').default('fresh'),
  candidate_count: z.number().int().min(1).max(24).default(12), cast_size: z.number().int().min(1).max(12).default(6), game_mode: z.boolean().default(true),
}).strict().refine(b => b.cast_size <= b.candidate_count, 'Cast exceeds candidates');
export type Brief = z.infer<typeof briefSchema>;
export const templateSchema=z.object({template_id:z.string().trim().min(1).max(80),revision:z.number().int().positive(),behavior_family:text,permitted_variation:strings.min(1),disallowed_combinations:strings,examples:z.array(z.object({situation:text,response:text}).strict()).max(12)}).strict();
export type PersonaTemplate=z.infer<typeof templateSchema>;
export function planningBrief(b: Brief) {
  return { topic: b.topic, audience_intent: b.audience_intent, public_context: b.public_context, language: b.language, tone_policy: b.tone_policy };
}
export const responseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), text: z.string().trim().min(1).max(2000), responding_to_event_ids: z.array(text).min(1).max(3), factual_support_refs: z.array(text).max(8) }).strict(),
  z.object({ action: z.literal('skip'), reason: z.enum(['not_interested','already_covered','insufficient_context','no_useful_contribution','out_of_character','unsafe']) }).strict(),
]);
export type ViewerResponse = z.infer<typeof responseSchema>;
const band = z.object({ min_messages: z.number().int().nonnegative(), max_messages: z.number().int().nonnegative().nullable(), ai_cap_messages_per_window: z.number().int().nonnegative().max(30) }).strict();
export const policySchema = z.object({
  max_selected_per_event_group: z.number().int().min(1).max(3).default(1),
  max_inflight_per_session: z.number().int().min(1).max(8).default(2),
  max_consecutive_messages_from_one_persona: z.number().int().min(1).max(5).default(2),
  rolling_window_ms: z.number().int().min(1000).max(300000).default(60000),
  global_hard_cap_messages_per_window: z.number().int().min(1).max(30).default(6),
  minimum_global_gap_ms: z.number().int().nonnegative().max(60000).default(5000),
  persona_cooldown_ms: z.number().int().nonnegative().max(300000).default(30000),
  upstream_activity_bands: z.array(band).min(1).max(10).default([
    { min_messages: 0, max_messages: 4, ai_cap_messages_per_window: 4 },
    { min_messages: 5, max_messages: 19, ai_cap_messages_per_window: 2 },
    { min_messages: 20, max_messages: null, ai_cap_messages_per_window: 1 },
  ]),
  response_delay_min_ms: z.number().int().nonnegative().max(10000).default(500),
  response_delay_max_ms: z.number().int().nonnegative().max(10000).default(2500),
  max_ai_trigger_depth: z.number().int().min(0).max(2).default(2),
  reaction_queue_capacity: z.number().int().min(1).max(1000).default(200),
  reaction_ttl_ms: z.number().int().min(100).max(60000).default(12000),
  max_observation_age_ms: z.number().int().min(100).max(60000).default(12000),
  model_timeout_ms: z.number().int().min(50).max(30000).default(6000),
  schema_repair_attempts: z.number().int().min(0).max(1).default(1),
  max_chat_code_points: z.number().int().min(10).max(500).default(160),
  max_input_tokens: z.number().int().min(1000).max(32000).default(4000),
  max_output_tokens: z.number().int().min(64).max(1024).default(256),
  max_recent_public_messages: z.number().int().min(1).max(50).default(30),
  max_own_recent_messages: z.number().int().min(1).max(20).default(10),
  max_retrieved_memories: z.number().int().min(0).max(20).default(8),
  max_live_model_calls_per_session: z.number().int().min(1).max(10000).default(300),
  max_authoring_model_calls_per_job: z.number().int().min(1).max(1000).default(200),
  warn_at_fraction: probability.default(.8),
  estimated_cost_cap_usd: z.number().positive().nullable().default(null),
  input_usd_per_million: z.number().nonnegative().nullable().default(null),
  output_usd_per_million: z.number().nonnegative().nullable().default(null),
  session_event_days: z.number().int().min(1).max(30).default(7),
  transient_model_payload_hours: z.number().int().min(1).max(24).default(24),
  operator_audit_days: z.number().int().min(1).max(90).default(90),
  allow_persistent_memory: z.literal(false).default(false),
}).strict().superRefine((p,c) => {
  const fail = (message: string) => c.addIssue({ code:'custom', message });
  if(p.response_delay_min_ms > p.response_delay_max_ms) fail('Invalid delay range');
  let next = 0;
  for (const [i,b] of p.upstream_activity_bands.entries()) {
    if(b.min_messages !== next || (b.max_messages !== null && b.max_messages < b.min_messages) || (b.max_messages === null && i !== p.upstream_activity_bands.length-1)) fail('Bands must be contiguous');
    next = (b.max_messages ?? -1) + 1;
  }
  if(p.upstream_activity_bands.at(-1)?.max_messages !== null) fail('Bands must cover all activity');
  if(p.estimated_cost_cap_usd !== null && (p.input_usd_per_million === null || p.output_usd_per_million === null)) fail('A monetary cap requires a price table');
});
export type Policy = z.infer<typeof policySchema>;
export const observationSchema = z.object({
  event_id: z.string().uuid(), session_id: z.string().uuid(), event_seq: z.number().int().positive(),
  source_type: z.enum(['human_chat','ai_chat','streamer_speech','screen_observation','public_recap']),
  upstream_dedup_key: z.string().max(300).nullable(), received_at: z.number().nonnegative(), occurred_at: z.number().nonnegative().nullable(),
  stream_offset_ms: z.number().nonnegative().nullable(), time_basis: z.enum(['media_aligned','received','unknown']), public_author_ref: z.string().nullable(),
  text: z.string().min(1).max(4000), topic_tags: strings, related_event_ids: z.array(z.string().uuid()).max(10), ai_trigger_depth: z.number().int().nonnegative(),
  expires_at: z.number().nullable(), source_confidence: probability.nullable(),
}).strict();
export type Observation = z.infer<typeof observationSchema>;
export interface Presence { joined_at: number; joined_after_event_seq: number; joined_stream_offset_ms: number | null; left_at: number | null; left_after_event_seq: number | null; left_stream_offset_ms: number | null }
export interface Member { id: string; persona_id: string; version_id: string; snapshot: Definition; hash: string; display_name: string; public_author_id: string; presence: 'scheduled'|'present'|'departed'; muted: boolean; attention: number; current_focus_tags: string[]; epoch: number; revision: number; intervals: Presence[]; last_published_at: number | null; guessing_eligible: boolean }
export const memorySchema = z.object({
  memory_id: z.string().uuid(), owner_persona_id: z.string().uuid(), scope: z.literal('session'), source_session_id: z.string().uuid(),
  kind: z.enum(['observation','viewer_claim','interpretation','self_statement','commitment','open_interest','correction']), summary: text,
  source_event_ids: z.array(z.string().uuid()).min(1).max(10), learned_via: z.enum(['live_exposure','public_recap','self_message']),
  learned_at: z.number().nonnegative(), learned_at_event_seq: z.number().int().positive(), event_stream_offset_ms: z.number().nullable(),
  status: z.enum(['active','superseded','expired','deleted']), supersedes_memory_id: z.string().uuid().nullable(), importance: probability, topic_tags: strings, expires_at: z.number().nullable(), retention_approved_by: z.null(),
}).strict();
export type Memory = z.infer<typeof memorySchema>;
export function canonical(v: unknown): string {
  if(Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if(v !== null && typeof v === 'object') return '{' + Object.entries(v).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,x]) => JSON.stringify(k)+':'+canonical(x)).join(',') + '}';
  return JSON.stringify(v);
}
export const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export const normalizeName = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{Cf}\p{P}]/gu, '');
export function exposed(e: Observation, m: Member, cutoff: number) {
  return e.event_seq <= cutoff && m.intervals.some(p => e.event_seq > p.joined_after_event_seq && (p.left_after_event_seq === null || e.event_seq <= p.left_after_event_seq)
    && e.received_at >= p.joined_at && (p.left_at === null || e.received_at <= p.left_at)
    && (e.occurred_at === null || e.occurred_at >= p.joined_at)
    && (e.time_basis !== 'media_aligned' || e.stream_offset_ms === null || (p.joined_stream_offset_ms !== null && e.stream_offset_ms >= p.joined_stream_offset_ms && (p.left_stream_offset_ms === null || e.stream_offset_ms <= p.left_stream_offset_ms))));
}
export class PersonaError extends Error {
  constructor(public code: string, public statusCode = 409, public retryable = false) { super(code); }
}
export function ensure(condition: unknown, code: string): asserts condition { if(!condition) throw new PersonaError(code); }
