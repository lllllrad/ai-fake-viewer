import { loadEnvFile } from "node:process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { loadConfig } from "../../packages/config.ts";
import { createApp } from "./app.ts";
import { launchServer } from "./startup.ts";
if (existsSync(".env")) loadEnvFile(".env");
try {
  const demo = process.argv.includes("--demo");
  const config = loadConfig();
  if (demo) {
    config.database = "data/demo.sqlite";
    config.ai.visualMode = "continuous";
  }
  const { app, store, broadcast, scheduler } = await createApp(config, {
    startInputs: false,
    demo,
    adminToken: process.env.ADMIN_TOKEN ?? "",
    readerToken: process.env.READER_TOKEN ?? "",
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
    persistReaderToken: (token) => {
      const text = readFileSync(".env", "utf8");
      const lines = text
        .split("\n")
        .filter((line) => !line.startsWith("READER_TOKEN="));
      writeFileSync(
        ".env.tmp",
        lines.join("\n") + "\nREADER_TOKEN=" + token + "\n",
        { mode: 0o600 },
      );
      renameSync(".env.tmp", ".env");
      process.env.READER_TOKEN = token;
    },
  });
  scheduler.onDiagnostic = (entry) =>
    console.log(JSON.stringify({ type: "ai_diagnostic", ...entry }));
  await launchServer({
    listen: () =>
      app.listen({ host: config.network.bindHost, port: config.port }),
    startInputs: () => {
      if (!store.closed()) broadcast.startInputs();
    },
    close: () => app.close(),
  });
  console.log(
    `${demo ? "DEMO — artificial chat and frames" : "AI STREAM — dedicated screen and microphone"}\nAdmin: http://127.0.0.1:${config.port}/admin\nUse ADMIN_TOKEN from .env to sign in. Public links are available in admin. Ctrl+C stops the server.`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await app.close();
      process.exit(0);
    } catch {
      console.error("Server shutdown finished with resource cleanup errors.");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
} catch (e) {
  if (e && typeof e === "object" && "issues" in e)
    console.error(
      "Configuration invalid:",
      (e as any).issues
        .map((i: any) => `${i.path.join(".")}: ${i.message}`)
        .join("\n"),
    );
  else
    console.error(
      "Startup failed. Check Node 24, .env credentials, config.yaml, database access and the port.",
    );
  process.exitCode = 1;
}
