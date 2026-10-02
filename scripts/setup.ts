import { existsSync, writeFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env"))
  writeFileSync(
    ".env",
    `ADMIN_TOKEN=${randomBytes(32).toString("hex")}\nREADER_TOKEN=${randomBytes(32).toString("hex")}\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\nOPENAI_API_KEY=\nOPENAI_MODEL=\nYOUTUBE_API_KEY=\nYOUTUBE_ACCESS_TOKEN=\nCHZZK_CLIENT_ID=\nCHZZK_CLIENT_SECRET=\n`,
    { mode: 0o600 },
  );
if (!existsSync("config.yaml"))
  copyFileSync("config.example.yaml", "config.yaml");
console.log(
  "Local .env and config.yaml are ready. Keep .env private. Run npm run build, then npm run demo or npm start.",
);
