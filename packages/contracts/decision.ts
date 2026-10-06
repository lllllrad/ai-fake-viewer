import { z } from "zod";
export const decisionSchema = z
  .object({
    action: z.enum(["say", "skip", "inspect"]),
    text: z.string().nullable(),
    replyToMessageId: z.string().nullable(),
    evidenceFrameIds: z.array(z.string()).max(3),
    evidenceMessageIds: z.array(z.string()).max(80),
    evidenceTranscriptIds: z.array(z.string()).max(12).default([]),
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
    "evidenceTranscriptIds",
  ],
  properties: {
    action: { type: "string", enum: ["say", "skip", "inspect"] },
    text: { type: ["string", "null"] },
    replyToMessageId: { type: ["string", "null"] },
    evidenceFrameIds: { type: "array", items: { type: "string" } },
    evidenceMessageIds: { type: "array", items: { type: "string" } },
    evidenceTranscriptIds: { type: "array", items: { type: "string" } },
  },
};
