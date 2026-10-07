import { z } from "zod";

export const modelToolSchema = z
  .object({
    type: z.literal("function"),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    description: z.string().max(4000),
    parameters: z.record(z.string(), z.json()),
    strict: z.literal(true),
  })
  .strict();
export const modelToolCallSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1).max(200),
  name: z.string().min(1).max(64),
  arguments: z.string().max(16000),
});
export type ModelTool = z.infer<typeof modelToolSchema>;
export type ModelToolCall = z.infer<typeof modelToolCallSchema>;
/** Bounded provider continuation items, retained only for the current tool workflow. */
export const continuationItemSchema = z.union([
  modelToolCallSchema,
  z.object({
    type: z.literal("function_call_output"),
    call_id: z.string().max(200),
    output: z.string().max(16000),
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string().max(200).optional(),
    summary: z.array(z.json()).max(20),
    encrypted_content: z.string().max(100000).optional(),
  }),
]);
export type ModelContinuationItem = z.infer<typeof continuationItemSchema>;
export const viewerStateSchema = z
  .record(z.string().max(80), z.json())
  .refine(
    (state) =>
      Object.keys(state).length <= 24 && JSON.stringify(state).length <= 8000,
    "Viewer state too large",
  );
export type ViewerState = z.infer<typeof viewerStateSchema>;
export const viewerMemorySchema = z.object({
  memberId: z.string(),
  binding: z.string(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number(),
  expiresAt: z.number(),
  values: viewerStateSchema,
  sourceMessageIds: z.array(z.string()).max(80).optional(),
});
export type ViewerMemory = z.infer<typeof viewerMemorySchema>;
