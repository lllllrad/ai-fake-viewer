import { z } from "zod";
const text = z.string().trim().min(1).max(1000);
const probability = z.number().min(0).max(1);
export const briefSchema = z
  .object({
    session_title: text,
    topic: text,
    audience_intent: text,
    public_context: z.string().max(4000),
    private_production_context: z.string().max(4000),
    language: z.string().min(2).max(30).default("ko-KR"),
    tone_policy: text,
    cast_mode: z.literal("fresh").default("fresh"),
    candidate_count: z.number().int().min(1).max(24).default(12),
    cast_size: z.number().int().min(1).max(12).default(6),
    game_mode: z.boolean().default(true),
  })
  .strict()
  .refine((b) => b.cast_size <= b.candidate_count, "Cast exceeds candidates");
export type Brief = z.infer<typeof briefSchema>;
const band = z
  .object({
    min_messages: z.number().int().nonnegative(),
    max_messages: z.number().int().nonnegative().nullable(),
    ai_cap_messages_per_window: z.number().int().nonnegative().max(30),
  })
  .strict();
export const policySchema = z
  .object({
    max_selected_per_event_group: z.number().int().min(1).max(3).default(1),
    max_inflight_per_session: z.number().int().min(1).max(8).default(2),
    max_consecutive_messages_from_one_persona: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(2),
    rolling_window_ms: z.number().int().min(1000).max(300000).default(60000),
    global_hard_cap_messages_per_window: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(6),
    minimum_global_gap_ms: z
      .number()
      .int()
      .nonnegative()
      .max(60000)
      .default(5000),
    persona_cooldown_ms: z
      .number()
      .int()
      .nonnegative()
      .max(300000)
      .default(30000),
    upstream_activity_bands: z
      .array(band)
      .min(1)
      .max(10)
      .default([
        { min_messages: 0, max_messages: 4, ai_cap_messages_per_window: 4 },
        { min_messages: 5, max_messages: 19, ai_cap_messages_per_window: 2 },
        { min_messages: 20, max_messages: null, ai_cap_messages_per_window: 1 },
      ]),
    response_delay_min_ms: z
      .number()
      .int()
      .nonnegative()
      .max(10000)
      .default(500),
    response_delay_max_ms: z
      .number()
      .int()
      .nonnegative()
      .max(10000)
      .default(2500),
    max_ai_trigger_depth: z.number().int().min(0).max(2).default(2),
    reaction_queue_capacity: z.number().int().min(1).max(1000).default(200),
    reaction_ttl_ms: z.number().int().min(100).max(60000).default(45000),
    max_observation_age_ms: z.number().int().min(100).max(60000).default(12000),
    model_timeout_ms: z.number().int().min(50).max(30000).default(30000),
    schema_repair_attempts: z.number().int().min(0).max(1).default(1),
    max_chat_code_points: z.number().int().min(10).max(500).default(160),
    max_input_tokens: z.number().int().min(1000).max(32000).default(4000),
    max_output_tokens: z.number().int().min(64).max(1024).default(256),
    max_recent_public_messages: z.number().int().min(1).max(50).default(30),
    max_own_recent_messages: z.number().int().min(1).max(20).default(10),
    max_retrieved_memories: z.number().int().min(0).max(20).default(8),
    // Legacy policy values no longer limit generation calls.
    max_live_model_calls_per_session: z.number().optional(),
    max_authoring_model_calls_per_job: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(200),
    warn_at_fraction: probability.default(0.8),
    estimated_cost_cap_usd: z.number().positive().nullable().default(null),
    input_usd_per_million: z.number().nonnegative().nullable().default(null),
    output_usd_per_million: z.number().nonnegative().nullable().default(null),
    session_event_days: z.number().int().min(1).max(30).default(7),
    transient_model_payload_hours: z.number().int().min(1).max(24).default(24),
    operator_audit_days: z.number().int().min(1).max(90).default(90),
    allow_persistent_memory: z.literal(false).default(false),
  })
  .strict()
  .superRefine((p, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    if (p.response_delay_min_ms > p.response_delay_max_ms)
      fail("Invalid delay range");
    let next = 0;
    for (const [i, b] of p.upstream_activity_bands.entries()) {
      if (
        b.min_messages !== next ||
        (b.max_messages !== null && b.max_messages < b.min_messages) ||
        (b.max_messages === null && i !== p.upstream_activity_bands.length - 1)
      )
        fail("Bands must be contiguous");
      next = (b.max_messages ?? -1) + 1;
    }
    if (p.upstream_activity_bands.at(-1)?.max_messages !== null)
      fail("Bands must cover all activity");
    if (
      p.estimated_cost_cap_usd !== null &&
      (p.input_usd_per_million === null || p.output_usd_per_million === null)
    )
      fail("A monetary cap requires a price table");
  });
export type Policy = z.infer<typeof policySchema>;
