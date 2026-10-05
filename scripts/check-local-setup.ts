import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { loadConfig } from "../packages/config.ts";
import { profileIssues } from "../packages/privacy-profile.ts";
import { ChatgptAuth } from "../packages/chatgpt-auth.ts";
import { ChzzkAuth } from "../packages/chzzk.ts";
import { YoutubeAuth } from "../packages/youtube-auth.ts";

// Read-only: no token refresh, platform receipt, notice send or model call.
// Never print credentials, account identifiers or raw configuration/error objects.
const missing: string[] = [];
const report = (label: string, ok: boolean, action: string) => {
  console.log(`${ok ? "OK" : "NEEDED"} ${label}${ok ? "" : `: ${action}`}`);
  if (!ok) missing.push(label);
};
try {
  if (existsSync(".env")) loadEnvFile(".env");
  const config = loadConfig();
  const has = (name: string) => !!process.env[name]?.trim();
  for (const key of ["ADMIN_TOKEN", "READER_TOKEN", "TOKEN_ENCRYPTION_KEY"])
    report(
      key,
      /^[a-f0-9]{64}$/i.test(process.env[key] ?? ""),
      "set a 32-byte hexadecimal value in .env; preserve existing keys",
    );
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (config.chzzk.enabled) {
    for (const key of ["CHZZK_CLIENT_ID", "CHZZK_CLIENT_SECRET"])
      report(key, has(key), "set the issued value in .env");
    if (/^[a-f0-9]{64}$/i.test(encryptionKey)) {
      try {
        const auth = new ChzzkAuth(encryptionKey);
        report(
          "CHZZK saved authorization",
          !!auth.token,
          "connect the broadcaster account in admin",
        );
        if (auth.token)
          console.log(
            "NOTE CHZZK: stored token presence does not verify current grants. After changing client credentials/scopes, reconnect the broadcaster account.",
          );
      } catch {
        report(
          "CHZZK saved authorization",
          false,
          "check the encryption key or reconnect; credential contents are not shown",
        );
      }
    }
    console.log(`CHZZK redirect URI: ${config.chzzk.redirectUri}`);
  }
  if (config.youtube.enabled) {
    const oauth = has("YOUTUBE_CLIENT_ID") && has("YOUTUBE_CLIENT_SECRET");
    report(
      "YouTube receipt credentials",
      has("YOUTUBE_API_KEY") || has("YOUTUBE_ACCESS_TOKEN") || oauth,
      "configure an API key or OAuth credentials",
    );
    report(
      "YouTube automatic-notice OAuth credentials",
      oauth,
      "set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET; keep the existing YOUTUBE_API_KEY",
    );
    report(
      "YouTube live target",
      !!(config.youtube.video || config.youtube.channelId),
      "set a live video or channel ID in config.yaml",
    );
    if (oauth && /^[a-f0-9]{64}$/i.test(encryptionKey)) {
      try {
        report(
          "YouTube saved authorization",
          new YoutubeAuth(encryptionKey).connected,
          "connect the broadcasting channel in admin",
        );
      } catch {
        report(
          "YouTube saved authorization",
          false,
          "check the encryption key or reconnect",
        );
      }
    }
    console.log(`YouTube redirect URI: ${config.youtube.redirectUri}`);
  }
  report(
    "AI provider matches privacy profile",
    config.ai.provider === config.privacy.processing.provider,
    "select the same authentication profile in ai and privacy.processing",
  );
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
          "Selected ChatGPT model matches profile",
          !!auth.active?.model &&
            auth.active.model === config.privacy.processing.model,
          "select an available model and match privacy.processing.model",
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
    report(
      "API model matches profile",
      has("OPENAI_MODEL") &&
        process.env.OPENAI_MODEL === config.privacy.processing.model,
      "set OPENAI_MODEL and match privacy.processing.model",
    );
  }
  const issues = profileIssues(config.privacy);
  report(
    "Live privacy profile",
    issues.length === 0,
    "complete actual operator/notices/processing/publication fields in config.yaml",
  );
  for (const issue of issues) console.log(`  - ${issue}`);
  for (const platform of ["youtube", "chzzk", "soop"] as const) {
    if (
      platform === "soop"
        ? config.soop.mode === "disabled"
        : !config[platform].enabled
    )
      continue;
    report(
      `${platform} broadcaster approvals`,
      config.privacy.approvals.some(
        (a) =>
          a.platform === platform &&
          a.broadcaster &&
          a.receive &&
          a.fixedNotices &&
          a.screenPublication &&
          a.externalAi &&
          a.contractReference &&
          a.checkedAt,
      ),
      "record actual broadcaster ID, reviewed permissions, evidence and check date; do not use a nickname",
    );
  }
  report(
    "Notice rate review",
    config.privacy.notices.approvedLimitConfirmed,
    "confirm the actual permitted account/global rates before enabling notices",
  );
  console.log(
    "Read-only local inspection only; no provider/platform permissions were tested. Real live tests need an approved profile and fresh viewer consent. Synthetic UI/flow tests: sh run-command.sh npm run demo (mock model).",
  );
  process.exitCode = missing.length ? 1 : 0;
} catch {
  console.error(
    "Local setup could not be read. Check config.yaml schema, .env syntax and file permissions. No secret values are printed.",
  );
  process.exitCode = 1;
}
