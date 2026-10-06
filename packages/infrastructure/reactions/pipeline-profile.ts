import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { definitionSchema } from "../../contracts/persona-definition.ts";
import { automaticDefinitions } from "../../persona/automatic.ts";
import { configSchema, type Config } from "../../config.ts";
import { defaultPrompts, type ModelPrompts } from "./model-messages.ts";

const patch = z
  .object({
    core: definitionSchema.shape.core.partial().optional(),
    voice: definitionSchema.shape.voice.partial().optional(),
    participation: definitionSchema.shape.participation.partial().optional(),
    knowledge: definitionSchema.shape.knowledge.optional(),
    examples: definitionSchema.shape.examples.optional(),
    negative_examples: definitionSchema.shape.negative_examples.optional(),
  })
  .strict();
export const pipelineProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    revision: z.number().int().positive(),
    description: z.string().max(2000).default(""),
    prompts: z
      .object({ answer: z.string().min(1), review: z.string().min(1) })
      .strict()
      .optional(),
    personas: z.array(patch).length(6).optional(),
    ai: z
      .object({
        reviewDraft: z.boolean().optional(),
        visualMode: z.enum(["continuous", "on_request"]).optional(),
        contextWindowSeconds: z.number().int().min(30).max(300).optional(),
        transcriptLimit: z.number().int().min(1).max(10).optional(),
        pacing: z
          .object({
            minSeconds: z.number().int().min(20).max(600),
            maxSeconds: z.number().int().min(20).max(600),
          })
          .strict()
          .refine((p) => p.maxSeconds >= p.minSeconds)
          .optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type PipelineProfile = z.infer<typeof pipelineProfileSchema>;
export interface LoadedPipeline {
  profile: PipelineProfile;
  prompts: ModelPrompts;
  digest: string;
}
export function loadPipelineProfile(path?: string): LoadedPipeline {
  const profile = pipelineProfileSchema.parse(
    path
      ? JSON.parse(readFileSync(path, "utf8"))
      : { schemaVersion: 1, id: "builtin", revision: 1 },
  );
  const prompts =
    profile.prompts && path
      ? {
          answer: readFileSync(
            resolve(dirname(path), profile.prompts.answer),
            "utf8",
          ).trim(),
          review: readFileSync(
            resolve(dirname(path), profile.prompts.review),
            "utf8",
          ).trim(),
        }
      : { ...defaultPrompts };
  if (
    !prompts.answer ||
    !prompts.review ||
    prompts.answer.length > 100000 ||
    prompts.review.length > 100000
  )
    throw Error("Invalid pipeline prompts");
  return {
    profile,
    prompts,
    digest: createHash("sha256")
      .update(JSON.stringify({ profile, prompts }))
      .digest("hex"),
  };
}
export function applyPipelineProfile(
  config: Config,
  pipeline: LoadedPipeline,
): Config {
  return configSchema.parse({
    ...config,
    ai: { ...config.ai, ...pipeline.profile.ai },
  });
}
export function pipelineCards(
  pipeline: LoadedPipeline,
  runtime?: Parameters<typeof automaticDefinitions>[1],
) {
  return (topic: string) =>
    automaticDefinitions(topic, runtime).map((card, index) => ({
      ...card,
      definition: definitionSchema.parse({
        ...card.definition,
        ...pipeline.profile.personas?.[index],
        core: {
          ...card.definition.core,
          ...pipeline.profile.personas?.[index]?.core,
        },
        voice: {
          ...card.definition.voice,
          ...pipeline.profile.personas?.[index]?.voice,
        },
        participation: {
          ...card.definition.participation,
          ...pipeline.profile.personas?.[index]?.participation,
        },
      }),
    }));
}
