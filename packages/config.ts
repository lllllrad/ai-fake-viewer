import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
const rect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (r) => r.x + r.width <= 1 && r.y + r.height <= 1,
    "Mask must fit inside the image",
  );
const gateSchema = z
  .object({
    enabled: z.boolean().default(false),
    model: z.string().trim().min(1).max(100).default("jev-latest"),
    threshold: z.number().min(0).max(1).default(0.5),
    maxRequests: z.number().int().min(1).max(10000).default(360),
    timeoutMs: z.number().int().min(100).max(10000).default(3000),
  })
  .strict();
export const configSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).default(3210),
    network: z
      .object({
        bindHost: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
        publicBaseUrl: z.string().max(200).default(""),
      })
      .strict()
      .default({ bindHost: "127.0.0.1", publicBaseUrl: "" }),
    database: z.string().default("data/chat.sqlite"),
    retentionDays: z.number().int().min(1).max(7).default(7),
    youtube: z
      .object({
        enabled: z.boolean().default(false),
        video: z.string().default(""),
        transport: z.enum(["grpc", "rest"]).default("grpc"),
        restFallback: z.boolean().default(true),
      })
      .strict()
      .default({
        enabled: false,
        video: "",
        transport: "grpc",
        restFallback: true,
      }),
    chzzk: z
      .object({
        enabled: z.boolean().default(false),
        redirectUri: z
          .string()
          .url()
          .default("http://127.0.0.1:3210/oauth/chzzk/callback"),
      })
      .strict()
      .default({
        enabled: false,
        redirectUri: "http://127.0.0.1:3210/oauth/chzzk/callback",
      }),
    soop: z
      .object({
        mode: z
          .enum(["disabled", "official", "experimental_library"])
          .default("disabled"),
        experimentalConsent: z.boolean().default(false),
        streamerId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]*$/)
          .default(""),
      })
      .strict()
      .default({
        mode: "disabled",
        experimentalConsent: false,
        streamerId: "",
      }),
    capture: z
      .object({
        enabled: z.boolean().default(false),
        ffmpeg: z.string().default("ffmpeg"),
        backend: z
          .enum(["dshow", "v4l2", "avfoundation", "rtmp"])
          .default("dshow"),
        device: z.string().default("OBS Virtual Camera"),
        url: z.string().max(1024).default(""),
        intervalMs: z.number().int().min(1000).max(5000).default(3000),
        programConfirmed: z.boolean().default(false),
        masks: z.array(rect).max(30).default([]),
      })
      .strict()
      .default({
        enabled: false,
        ffmpeg: "ffmpeg",
        backend: "dshow",
        device: "OBS Virtual Camera",
        url: "",
        intervalMs: 3000,
        programConfirmed: false,
        masks: [],
      }),
    audio: z
      .object({
        enabled: z.boolean().default(false),
        ffmpeg: z.string().default("ffmpeg"),
        url: z.string().max(1024).default(""),
        language: z
          .string()
          .regex(
            /^(?:[a-z]{2})?$/,
            "Use a two-letter language code or empty for automatic detection",
          )
          .default(""),
        chunkSeconds: z.number().int().min(10).max(30).default(10),
        maxRequests: z.number().int().min(1).max(10000).default(360),
      })
      .strict()
      .default({
        enabled: false,
        ffmpeg: "ffmpeg",
        url: "",
        chunkSeconds: 10,
        maxRequests: 360,
        language: "",
      }),
    policy: z
      .object({
        youtubeAiContextApproved: z.boolean().default(false),
        chzzkAiContextApproved: z.boolean().default(false),
        soopAiContextApproved: z.boolean().default(false),
        reviewReference: z.string().max(1000).default(""),
        providerReviewed: z.boolean().default(false),
        groqAudioReviewed: z.boolean().default(false),
        typesafeReviewed: z.boolean().default(false),
      })
      .strict()
      .default({
        youtubeAiContextApproved: false,
        chzzkAiContextApproved: false,
        soopAiContextApproved: false,
        reviewReference: "",
        providerReviewed: false,
        groqAudioReviewed: false,
        typesafeReviewed: false,
      }),
    ai: z
      .object({
        provider: z
          .enum(["chatgpt_subscription", "openai_api"])
          .default("chatgpt_subscription"),
        gate: gateSchema.default(() => gateSchema.parse({})),
        pacing: z
          .object({
            minSeconds: z.number().int().min(20).max(600).default(35),
            maxSeconds: z.number().int().min(20).max(600).default(95),
          })
          .strict()
          .refine(
            (v) => v.maxSeconds >= v.minSeconds,
            "maxSeconds must be at least minSeconds",
          )
          .default({ minSeconds: 35, maxSeconds: 95 }),
        contextWindowSeconds: z.number().int().min(30).max(300).default(120),
        manualApproval: z.boolean().default(false),
        visualMode: z.enum(["continuous", "on_request"]).default("continuous"),
        maxCalls: z.number().int().min(1).max(10000).default(100),
        maxInputTokens: z.number().int().min(1000).max(100000).default(24000),
        maxOutputTokens: z.number().int().min(200).max(2000).default(500),
        maxUsd: z.number().positive().nullable().default(null),
        inputUsdPerMillion: z.number().nonnegative().nullable().default(null),
        outputUsdPerMillion: z.number().nonnegative().nullable().default(null),
        priceCheckedAt: z.string().default(""),
        description: z
          .string()
          .max(1000)
          .default("A live broadcast. React only to what is visible."),
        personas: z
          .array(
            z
              .object({
                name: z.string().min(1).max(40),
                style: z.string().max(300),
              })
              .strict(),
          )
          .min(1)
          .max(6)
          .default([
            {
              name: "Orbit · experiment",
              style: "Brief, curious Korean spectator.",
            },
            {
              name: "Pebble · experiment",
              style: "Playful visual comparisons in short Korean.",
            },
          ]),
      })
      .strict()
      .default({
        provider: "chatgpt_subscription",
        gate: gateSchema.parse({}),
        pacing: { minSeconds: 35, maxSeconds: 95 },
        contextWindowSeconds: 120,
        manualApproval: false,
        visualMode: "continuous",
        maxCalls: 100,
        maxInputTokens: 24000,
        maxOutputTokens: 500,
        maxUsd: null,
        inputUsdPerMillion: null,
        outputUsdPerMillion: null,
        priceCheckedAt: "",
        description: "A live broadcast. React only to what is visible.",
        personas: [
          {
            name: "Orbit · experiment",
            style: "Brief, curious Korean spectator.",
          },
          {
            name: "Pebble · experiment",
            style: "Playful visual comparisons in short Korean.",
          },
        ],
      }),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.network.bindHost === "0.0.0.0") {
      let valid = false;
      try {
        const u = new URL(c.network.publicBaseUrl);
        valid =
          u.protocol === "http:" &&
          u.port === String(c.port) &&
          u.pathname === "/" &&
          !u.search &&
          !u.hash &&
          !u.username &&
          !u.password &&
          !["127.0.0.1", "localhost", "0.0.0.0"].includes(u.hostname);
      } catch {
        /* invalid URL */
      }
      if (!valid)
        ctx.addIssue({
          code: "custom",
          path: ["network", "publicBaseUrl"],
          message:
            "LAN mode requires an HTTP base URL with this port and a non-loopback host",
        });
    }
    if (c.ai.gate.enabled && c.ai.visualMode !== "on_request")
      ctx.addIssue({
        code: "custom",
        path: ["ai", "gate", "enabled"],
        message: "The text-only Jev gate requires ai.visualMode: on_request",
      });
    if (c.audio.enabled) {
      let valid = false;
      try {
        const url = new URL(c.audio.url);
        valid =
          ["rtmp:", "rtmps:"].includes(url.protocol) &&
          !!url.hostname &&
          !url.username &&
          !url.password;
      } catch {
        /* invalid URL */
      }
      if (!valid)
        ctx.addIssue({
          code: "custom",
          path: ["audio", "url"],
          message:
            "Audio transcription requires an RTMP URL without authority credentials",
        });
    }
    if (c.capture.backend === "rtmp") {
      let valid = false;
      try {
        const url = new URL(c.capture.url);
        valid =
          ["rtmp:", "rtmps:"].includes(url.protocol) &&
          !!url.hostname &&
          !url.username &&
          !url.password;
      } catch {
        /* invalid URL */
      }
      if (!valid)
        ctx.addIssue({
          code: "custom",
          path: ["capture", "url"],
          message:
            "RTMP capture requires an rtmp:// or rtmps:// URL without embedded credentials",
        });
    }
    if (c.ai.provider === "chatgpt_subscription" && c.ai.maxUsd !== null)
      ctx.addIssue({
        code: "custom",
        message: "USD budgets apply only to the API-key provider",
      });
    if (
      c.ai.provider === "openai_api" &&
      c.ai.maxUsd !== null &&
      (c.ai.inputUsdPerMillion === null ||
        c.ai.outputUsdPerMillion === null ||
        !c.ai.priceCheckedAt)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Money budgets require verified input/output prices and priceCheckedAt",
      });
    if (
      Object.entries(c.policy).some(
        ([k, v]) => k.endsWith("Approved") && v === true,
      ) &&
      !c.policy.reviewReference
    )
      ctx.addIssue({
        code: "custom",
        message:
          "AI context approval requires a documented policy review reference",
      });
    if (new Set(c.ai.personas.map((p) => p.name)).size !== c.ai.personas.length)
      ctx.addIssue({ code: "custom", message: "Persona names must be unique" });
  });
export type Config = z.infer<typeof configSchema>;
export function loadConfig() {
  return configSchema.parse(
    existsSync("config.yaml") ? parse(readFileSync("config.yaml", "utf8")) : {},
  );
}
