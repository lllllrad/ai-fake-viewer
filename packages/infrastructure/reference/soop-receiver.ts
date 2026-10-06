import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/** Historical library experiment; live participation never selects this receiver. */
export async function runReferenceSoop(
  streamerId: string,
  signal: AbortSignal,
  ports: {
    worker(): ChildProcess;
    status(state: string): void;
    receive(message: unknown): void;
    recovered(): void;
  },
) {
  let attempts = 0;
  while (!signal.aborted) {
    ports.status("connecting:unofficial");
    const child = ports.worker();
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => child.kill(), 20000);
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("error", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.on("message", (m: any) => {
        if (signal.aborted) return;
        if (m.type === "ready") {
          clearTimeout(timeout);
          ports.status("subscribed:unofficial");
          attempts = 0;
        } else if (m.type === "CHAT") ports.receive(m.data);
      });
      child.send({
        type: "connect",
        streamerId: streamerId,
      });
    });
    signal.removeEventListener("abort", abort);
    child.kill();
    if (signal.aborted) break;
    ports.recovered();
    if (++attempts >= 6) {
      ports.status("failed:check_broadcast_and_library");
      return;
    }
    ports.status("reconnecting:unofficial");
    await sleep(Math.min(30000, 1000 * 2 ** attempts), undefined, {
      signal,
    }).catch(() => {});
  }
}
