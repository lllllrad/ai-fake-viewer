import { existsSync, readFileSync } from "node:fs";
import { createAiService } from "./app.ts";
const port = Number(process.env.AI_SERVICE_PORT ?? 3212);
const token =
  process.env.AI_SERVICE_TOKEN ??
  (existsSync(".local/ai-service.token")
    ? readFileSync(".local/ai-service.token", "utf8").trim()
    : "");
const app = createAiService(token);
await app.listen({ host: "127.0.0.1", port });
const address = app.server.address();
if (address && typeof address !== "string") {
  process.send?.({ port: address.port });
  console.log(`AI service ready on local port ${address.port}`);
}
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
