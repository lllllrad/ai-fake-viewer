import { z } from "zod";
const atMs = z.number().int().min(0).max(600000);
const text = z.string().min(1).max(4000);
export const scenarioSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    description: z.string().max(2000),
    topic: z.string().min(1).max(1000),
    durationMs: z.number().int().min(1000).max(600000),
    events: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("speech"), atMs, text }).strict(),
          z
            .object({
              kind: z.literal("frame"),
              atMs,
              file: z.string().min(1).max(1024),
            })
            .strict(),
        ]),
      )
      .max(1000),
    expectations: z
      .object({
        minPublished: z.number().int().nonnegative().optional(),
        maxPublished: z.number().int().nonnegative().optional(),
        forbiddenText: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ forbiddenText: [] }),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.events.some(
        (e, i) =>
          e.atMs > s.durationMs || (i > 0 && e.atMs < s.events[i - 1].atMs),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Events must be ordered and within durationMs",
      });
  });
export type Scenario = z.infer<typeof scenarioSchema>;
