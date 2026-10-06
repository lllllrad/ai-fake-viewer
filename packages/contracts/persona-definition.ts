import { z } from "zod";
const text = z.string().trim().min(1).max(1000);
const strings = z.array(text).max(20);
const probability = z.number().min(0).max(1);
export const exampleSchema = z.discriminatedUnion("action", [
  z.object({ situation: text, action: z.literal("send"), text }).strict(),
  z.object({ situation: text, action: z.literal("skip") }).strict(),
]);
export const definitionSchema = z
  .object({
    schema_version: z.literal(1),
    persona_id: z.string().uuid(),
    definition_version: z.number().int().positive(),
    template_revision_id: text,
    locale: text,
    display_name_suggestion: z.string().trim().min(1).max(60),
    core: z
      .object({
        viewing_motive: text,
        interests: strings.min(1),
        disinterest: strings.min(1),
        observation_focus: strings.min(1),
        temperament: text,
        social_behavior: text,
      })
      .strict(),
    knowledge: z
      .array(
        z
          .object({
            topic: text,
            level: z.enum(["unfamiliar", "basic", "intermediate", "expert"]),
            boundary: text,
          })
          .strict(),
      )
      .min(1)
      .max(12),
    voice: z
      .object({
        register: text,
        typical_length: z.enum(["very_short", "short", "mixed"]),
        punctuation_tendency: text,
        laughter_tendency: text,
        allowed_variation: strings,
        avoid: strings,
      })
      .strict(),
    participation: z
      .object({
        base_propensity: probability,
        topic_sensitivity: probability,
        reply_propensity: probability,
        speak_when: strings.min(1),
        stay_silent_when: strings.min(1),
      })
      .strict(),
    examples: z
      .array(exampleSchema)
      .min(4)
      .max(12)
      .refine(
        (v) => v.some((e) => e.action === "skip"),
        "A skip example is required",
      ),
    negative_examples: z
      .array(
        z.object({ situation: text, unacceptable_behavior: text }).strict(),
      )
      .min(2)
      .max(10),
  })
  .strict();
export type Definition = z.infer<typeof definitionSchema>;
