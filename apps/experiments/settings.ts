import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "../../packages/config-file.ts";
export const experimentSettingsSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).default(3211),
    audio: z
      .object({
        provider: z.enum(["groq", "openai"]).default("groq"),
        chunkSeconds: z.number().int().min(10).max(30).default(10),
        maxRequests: z.number().int().min(1).max(10000).default(360),
        language: z
          .string()
          .regex(/^(?:[a-z]{2})?$/)
          .default(""),
      })
      .default({
        provider: "groq",
        language: "",
        chunkSeconds: 10,
        maxRequests: 360,
      }),
    pipelineType: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/)
      .optional(),
    pipelineProfile: z.string().default(""),
  })
  .strict();
export type ExperimentSettings = z.infer<typeof experimentSettingsSchema>;
export const experimentDirectory = resolve(".local/experiments");
const providerKeys = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GROQ_API_KEY",
] as const;
/** Explicit setup copies only speech/pipeline settings and API credentials once. */
export function setupExperiments(directory = experimentDirectory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const configPath = join(directory, "config.json"),
    envPath = join(directory, ".env");
  if (!existsSync(configPath)) {
    const config = loadConfig();
    writeFileSync(
      configPath,
      JSON.stringify(
        experimentSettingsSchema.parse({
          audio: {
            provider: config.audio.provider,
            chunkSeconds: config.audio.chunkSeconds,
            maxRequests: config.audio.maxRequests,
            language: config.audio.language,
          },
          pipelineType: config.ai.pipelineType,
          pipelineProfile: config.ai.pipelineProfile,
        }),
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  }
  if (!existsSync(envPath)) {
    const source = existsSync(".env")
      ? parseEnv(readFileSync(".env", "utf8"))
      : {};
    const values: Record<string, string> = {
      EXPERIMENT_ADMIN_TOKEN: randomBytes(32).toString("hex"),
      EXPERIMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    };
    for (const key of providerKeys) {
      const value = process.env[key] ?? source[key];
      if (value) values[key] = value;
    }
    if (Object.values(values).some((value) => /['\r\n]/.test(value)))
      throw Error("Provider credential cannot be copied into test environment");
    writeFileSync(
      envPath,
      Object.entries(values)
        .map(([key, value]) => `${key}='${value}'`)
        .join("\n") + "\n",
      { mode: 0o600, flag: "wx" },
    );
  }
}
/** Runtime never reads the live .env/config or account token file. */
export function loadExperimentEnvironment(directory = experimentDirectory) {
  const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
  for (const key of providerKeys) {
    if (env[key]) process.env[key] = env[key];
    else delete process.env[key];
  }
  return {
    settings: experimentSettingsSchema.parse(
      JSON.parse(readFileSync(join(directory, "config.json"), "utf8")),
    ),
    adminToken: z.string().min(32).parse(env.EXPERIMENT_ADMIN_TOKEN),
    encryptionKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .parse(env.EXPERIMENT_ENCRYPTION_KEY),
  };
}
