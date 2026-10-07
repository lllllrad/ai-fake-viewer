import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
mkdirSync(".local", { recursive: true, mode: 0o700 });
if (!existsSync(".local/ai-service.token"))
  writeFileSync(".local/ai-service.token", randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
console.log("Local AI service credentials are ready.");
