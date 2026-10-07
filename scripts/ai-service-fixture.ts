import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
/** Foreground test child on an ephemeral port. Never uses the shared live AI service. */
export async function startAiServiceFixture() {
  const token = randomBytes(32).toString("hex");
  const child = fork(resolve("services/viewer-ai/main.ts"), [], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, AI_SERVICE_PORT: "0", AI_SERVICE_TOKEN: token },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("AI service fixture startup timed out"));
    }, 10000);
    child.once("message", (message: any) => {
      clearTimeout(timer);
      resolve(message.port);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error("AI service fixture exited"));
    });
  });
  child.unref();
  child.channel?.unref();
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.once("exit", stop);
  return { url: `http://127.0.0.1:${port}`, token, stop };
}
