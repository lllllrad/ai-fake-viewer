import { z } from "zod";
export const platforms = ["youtube", "chzzk", "soop"] as const;
export const incomingSchema = z
  .object({
    platform: z.enum([...platforms, "experiment"]),
    channel: z.string().min(1).max(256),
    author: z.string().min(1).max(256),
    name: z.string().min(1).max(120),
    text: z.string().min(1).max(4000),
    sourceId: z.string().max(256).nullable().default(null),
    publishedAt: z
      .number()
      .int()
      .min(0)
      .max(8640000000000000)
      .nullable()
      .default(null),
    replyToId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type Incoming = z.input<typeof incomingSchema>;
export type { ConversationMessage as PublicMessage } from "./contracts/conversation.ts";
export type { PublicEvent } from "./contracts/conversation.ts";
export {
  decisionSchema,
  decisionJsonSchema,
  type Decision,
} from "./contracts/decision.ts";
