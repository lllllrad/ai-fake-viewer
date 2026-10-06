import type { Brief } from "../contracts/cast-configuration.ts";
export {
  briefSchema,
  policySchema,
  type Brief,
  type Policy,
} from "../contracts/cast-configuration.ts";
import { type Definition } from "../contracts/persona-definition.ts";
export {
  definitionSchema,
  exampleSchema,
  type Definition,
} from "../contracts/persona-definition.ts";
import { z } from "zod";
import { createHash } from "node:crypto";
const text = z.string().trim().min(1).max(1000);
const strings = z.array(text).max(20);
const probability = z.number().min(0).max(1);
export const templateSchema = z
  .object({
    template_id: z.string().trim().min(1).max(80),
    revision: z.number().int().positive(),
    behavior_family: text,
    permitted_variation: strings.min(1),
    disallowed_combinations: strings,
    examples: z
      .array(z.object({ situation: text, response: text }).strict())
      .max(12),
  })
  .strict();
export type PersonaTemplate = z.infer<typeof templateSchema>;
export function planningBrief(b: Brief) {
  return {
    topic: b.topic,
    audience_intent: b.audience_intent,
    public_context: b.public_context,
    language: b.language,
    tone_policy: b.tone_policy,
  };
}
export const responseSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("send"),
      text: z.string().trim().min(1).max(2000),
      responding_to_event_ids: z.array(text).min(1).max(3),
      factual_support_refs: z.array(text).max(8),
    })
    .strict(),
  z
    .object({
      action: z.literal("skip"),
      reason: z.enum([
        "not_interested",
        "already_covered",
        "insufficient_context",
        "no_useful_contribution",
        "out_of_character",
        "unsafe",
      ]),
    })
    .strict(),
]);
export type ViewerResponse = z.infer<typeof responseSchema>;
export const observationSchema = z
  .object({
    event_id: z.string().uuid(),
    session_id: z.string().uuid(),
    event_seq: z.number().int().positive(),
    source_type: z.enum([
      "human_chat",
      "ai_chat",
      "streamer_speech",
      "screen_observation",
      "public_recap",
    ]),
    upstream_dedup_key: z.string().max(300).nullable(),
    received_at: z.number().nonnegative(),
    occurred_at: z.number().nonnegative().nullable(),
    stream_offset_ms: z.number().nonnegative().nullable(),
    time_basis: z.enum(["media_aligned", "received", "unknown"]),
    public_author_ref: z.string().nullable(),
    text: z.string().min(1).max(4000),
    topic_tags: strings,
    related_event_ids: z.array(z.string().uuid()).max(10),
    ai_trigger_depth: z.number().int().nonnegative(),
    expires_at: z.number().nullable(),
    source_confidence: probability.nullable(),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
export interface Presence {
  joined_at: number;
  joined_after_event_seq: number;
  joined_stream_offset_ms: number | null;
  left_at: number | null;
  left_after_event_seq: number | null;
  left_stream_offset_ms: number | null;
}
export interface Member {
  id: string;
  persona_id: string;
  version_id: string;
  snapshot: Definition;
  hash: string;
  display_name: string;
  public_author_id: string;
  presence: "scheduled" | "present" | "departed";
  muted: boolean;
  attention: number;
  current_focus_tags: string[];
  epoch: number;
  revision: number;
  intervals: Presence[];
  last_published_at: number | null;
  guessing_eligible: boolean;
}
export const memorySchema = z
  .object({
    memory_id: z.string().uuid(),
    owner_persona_id: z.string().uuid(),
    scope: z.literal("session"),
    source_session_id: z.string().uuid(),
    kind: z.enum([
      "observation",
      "viewer_claim",
      "interpretation",
      "self_statement",
      "commitment",
      "open_interest",
      "correction",
    ]),
    summary: text,
    source_event_ids: z.array(z.string().uuid()).min(1).max(10),
    learned_via: z.enum(["live_exposure", "public_recap", "self_message"]),
    learned_at: z.number().nonnegative(),
    learned_at_event_seq: z.number().int().positive(),
    event_stream_offset_ms: z.number().nullable(),
    status: z.enum(["active", "superseded", "expired", "deleted"]),
    supersedes_memory_id: z.string().uuid().nullable(),
    importance: probability,
    topic_tags: strings,
    expires_at: z.number().nullable(),
    retention_approved_by: z.null(),
  })
  .strict();
export type Memory = z.infer<typeof memorySchema>;
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export { normalizeName } from "../domain/cast/names.ts";
export function exposed(e: Observation, m: Member, cutoff: number) {
  return (
    e.event_seq <= cutoff &&
    m.intervals.some(
      (p) =>
        e.event_seq > p.joined_after_event_seq &&
        (p.left_after_event_seq === null ||
          e.event_seq <= p.left_after_event_seq) &&
        e.received_at >= p.joined_at &&
        (p.left_at === null || e.received_at <= p.left_at) &&
        (e.occurred_at === null || e.occurred_at >= p.joined_at) &&
        (e.time_basis !== "media_aligned" ||
          e.stream_offset_ms === null ||
          (p.joined_stream_offset_ms !== null &&
            e.stream_offset_ms >= p.joined_stream_offset_ms &&
            (p.left_stream_offset_ms === null ||
              e.stream_offset_ms <= p.left_stream_offset_ms))),
    )
  );
}
export { PersonaError, ensure } from "../application/cast/errors.ts";
