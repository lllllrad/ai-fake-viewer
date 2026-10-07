import { z } from "zod";
export const displayChatSchema = z
  .object({
    platform: z.enum(["youtube", "chzzk", "soop"]),
    channel: z.string().min(1).max(256),
    sourceId: z.string().min(1).max(256),
    author: z.string().min(1).max(256),
    name: z.string().min(1).max(120),
    text: z.string().min(1).max(4000),
  })
  .strict();
export type DisplayChat = z.infer<typeof displayChatSchema>;

export const displayChatSettingsSchema = z
  .object({
    youtube: z
      .object({
        enabled: z.boolean().default(false),
        video: z.string().max(2048).default(""),
        channelId: z.string().max(100).default(""),
        transport: z.enum(["grpc", "rest"]).default("grpc"),
        restFallback: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    chzzk: z
      .object({ enabled: z.boolean().default(false) })
      .strict()
      .prefault({}),
    soop: z
      .object({
        enabled: z.boolean().default(false),
        streamerId: z.string().max(100).default(""),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({});
export type DisplayChatSettings = z.infer<typeof displayChatSettingsSchema>;
export const displayChatStatusSchema = z.object({
  settings: displayChatSettingsSchema,
  platforms: z.record(
    z.enum(["youtube", "chzzk", "soop"]),
    z.object({
      state: z.string(),
      received: z.number(),
      lastReceived: z.number().nullable(),
      connected: z.boolean(),
      credentialsConfigured: z.boolean(),
    }),
  ),
  closed: z.boolean(),
});
export type DisplayChatStatus = z.infer<typeof displayChatStatusSchema>;
