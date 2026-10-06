import { z } from "zod";
export const inputTokenCountSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
});
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
});
export const completedResponseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(z.unknown()).default([]),
  usage: usageSchema.nullish(),
});
const eventSchema = z.object({ type: z.string() }).passthrough();
export function responseText(output: unknown[]) {
  const texts: string[] = [];
  for (const raw of output) {
    const item = eventSchema.parse(raw);
    if (item.type !== "message") continue;
    const content = z.array(z.unknown()).parse(item.content ?? []);
    for (const rawPart of content) {
      const part = eventSchema.parse(rawPart);
      if (part.type === "output_text") texts.push(z.string().parse(part.text));
    }
  }
  return texts.join("");
}
