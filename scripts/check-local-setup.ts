import { applyInputMode } from "../packages/infrastructure/inputs/input-mode.ts";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { loadConfig } from "../packages/config-file.ts";
import { ChatgptAuth } from "../packages/infrastructure/accounts/chatgpt-auth.ts";

// Read-only: no token refresh or provider calls.
// Never print credentials, account identifiers or raw configuration/error objects.
const missing: string[] = [];
const report = (label: string, ok: boolean, action: string) => {
  console.log(`${ok ? "OK" : "NEEDED"} ${label}${ok ? "" : `: ${action}`}`);
  if (!ok) missing.push(label);
};
try {
  if (existsSync(".env")) loadEnvFile(".env");
  const config = applyInputMode(loadConfig());
  report(
    "AI dedicated stream",
    !!config.input.streamUrl,
    "set input.streamUrl to the sanitized RTMP/RTMPS playback URL",
  );
  const has = (name: string) => !!process.env[name]?.trim();
  for (const key of ["ADMIN_TOKEN", "READER_TOKEN", "TOKEN_ENCRYPTION_KEY"])
    report(
      key,
      /^[a-f0-9]{64}$/i.test(process.env[key] ?? ""),
      "set a 32-byte hexadecimal value in .env; preserve existing keys",
    );
  report(
    config.audio.provider + " transcription key",
    has(config.audio.provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY"),
    "set the speech provider key",
  );
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (config.ai.provider === "chatgpt_subscription") {
    if (/^[a-f0-9]{64}$/i.test(encryptionKey)) {
      try {
        const auth = new ChatgptAuth(encryptionKey);
        report(
          "Sign in with ChatGPT",
          !!auth.active?.refreshToken &&
            !!auth.active.scopes.includes("chatgpt.tokens.use.direct"),
          "connect the operator account in admin",
        );
        report(
          "Selected ChatGPT model",
          !!auth.active?.model,
          "select an available model",
        );
      } catch {
        report(
          "Sign in with ChatGPT",
          false,
          "check the encryption key or reconnect",
        );
      }
    }
  } else {
    report("OpenAI API key", has("OPENAI_API_KEY"), "set OPENAI_API_KEY");
    report("API model", has("OPENAI_MODEL"), "set OPENAI_MODEL");
  }
  process.exitCode = missing.length ? 1 : 0;
} catch {
  console.error(
    "Local setup could not be read. Check config.yaml schema, .env syntax and file permissions. No secret values are printed.",
  );
  process.exitCode = 1;
}
