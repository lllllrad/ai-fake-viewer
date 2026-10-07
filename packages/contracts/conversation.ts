import { z } from "zod";

const timestamp = z.number().min(-8.64e15).max(8.64e15);

export const publicMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  actorId: z.string(),
  displayName: z.string(),
  text: z.string(),
  replyToId: z.string().nullable(),
  displayTime: timestamp,
  attribution: z.string(),
  seq: z.number().int(),
});
export type ConversationMessage = z.infer<typeof publicMessageSchema>;

const eventBase = {
  seq: z.number().int(),
  sessionId: z.string(),
  occurredAt: timestamp,
};
const conversationEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("message.added"),
    payload: publicMessageSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("message.updated"),
    payload: publicMessageSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("message.hidden"),
    payload: z.object({ id: z.string() }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("session.closed"),
    payload: z.unknown(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("identity.revealed"),
    payload: z.unknown(),
  }),
]);
export const conversationPacketSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    sessionId: z.string(),
    lastSeq: z.number().int(),
    messages: z.array(publicMessageSchema),
    closed: z.boolean(),
    demo: z.boolean().default(false),
  }),
  z.object({ type: z.literal("event"), event: conversationEventSchema }),
]);
export type ConversationPacket = z.infer<typeof conversationPacketSchema>;

export interface PublicEvent {
  seq: number;
  sessionId: string;
  type: string;
  occurredAt: number;
  payload: unknown;
}
export const conversationIdentitySchema = z.object({
  actorId: z.string(),
  displayName: z.string(),
  kind: z.enum(["system_generated", "platform_received"]),
});
export type ConversationIdentity = z.infer<typeof conversationIdentitySchema>;

export const readerAuthSchema = z.object({
  type: z.literal("auth"),
  token: z.string(),
  afterSeq: z.number().int().nonnegative().optional(),
});
