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
export interface PublicMessage {
  id: string;
  sessionId: string;
  actorId: string;
  displayName: string;
  text: string;
  replyToId: string | null;
  displayTime: number;
  attribution: string;
  seq: number;
}
export interface PublicEvent {
  seq: number;
  sessionId: string;
  type: string;
  occurredAt: number;
  payload: unknown;
}
export const decisionSchema = z
  .object({
    action: z.enum(["say", "skip"]),
    text: z.string().nullable(),
    replyToMessageId: z.string().nullable(),
    evidenceFrameIds: z.array(z.string()).max(3),
    evidenceMessageIds: z.array(z.string()).max(80),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export const decisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "text",
    "replyToMessageId",
    "evidenceFrameIds",
    "evidenceMessageIds",
  ],
  properties: {
    action: { type: "string", enum: ["say", "skip"] },
    text: { type: ["string", "null"] },
    replyToMessageId: { type: ["string", "null"] },
    evidenceFrameIds: { type: "array", items: { type: "string" } },
    evidenceMessageIds: { type: "array", items: { type: "string" } },
  },
};
