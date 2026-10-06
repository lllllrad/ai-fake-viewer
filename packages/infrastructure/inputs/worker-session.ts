import { fork } from "node:child_process";
import type { EventEmitter } from "node:events";
export interface InputProcess extends EventEmitter {
  connected: boolean;
  send(message: object): boolean;
  kill(): boolean;
}
export function workerEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        [
          "PATH",
          "SystemRoot",
          "WINDIR",
          "TEMP",
          "TMP",
          "HOME",
          "USERPROFILE",
        ].includes(key) && value,
    ),
  ) as NodeJS.ProcessEnv;
}
/** Owns one child generation and reconnect timer; released children cannot call owners. */
export class InputWorkerSession {
  child?: InputProcess;
  private generation = 0;
  private detach?: () => void;
  private cancelTimer?: () => void;
  private retryRevision = 0;
  constructor(
    private readonly url: URL,
    private readonly spawn: (url: URL) => InputProcess = (url) =>
      fork(url, [], {
        env: workerEnv(),
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      }),
    private readonly schedule: (
      ms: number,
      action: () => void,
    ) => () => void = (ms, action) => {
      const timer = setTimeout(action, ms);
      return () => clearTimeout(timer);
    },
  ) {}
  cancelRetry() {
    this.retryRevision++;
    const cancel = this.cancelTimer;
    this.cancelTimer = undefined;
    cancel?.();
  }
  retry(milliseconds: number, action: () => void) {
    this.cancelRetry();
    const generation = this.generation;
    const revision = this.retryRevision;
    this.cancelTimer = this.schedule(milliseconds, () => {
      if (generation !== this.generation || revision !== this.retryRevision)
        return;
      this.retryRevision++;
      this.cancelTimer = undefined;
      action();
    });
  }
  start(
    command: object,
    callbacks: {
      message(value: unknown): void;
      error(): void;
      exit(code: number | null, signal: string | null): void;
    },
  ) {
    if (this.child) return;
    this.cancelRetry();
    const generation = ++this.generation;
    let child: InputProcess;
    try {
      child = this.spawn(this.url);
    } catch {
      callbacks.error();
      return;
    }
    this.child = child;
    const current = () =>
      this.child === child && generation === this.generation;
    const message = (value: unknown) => {
      if (current()) callbacks.message(value);
    };
    const error = () => {
      if (current()) callbacks.error();
    };
    const exit = (code: unknown, signal: unknown) => {
      if (!current()) return;
      this.detach?.();
      this.detach = undefined;
      this.child = undefined;
      callbacks.exit(
        typeof code === "number" ? code : null,
        typeof signal === "string" ? signal : null,
      );
    };
    child.on("message", message);
    child.on("error", error);
    child.on("exit", exit);
    this.detach = () => {
      child.off("message", message);
      child.off("error", error);
      child.off("exit", exit);
      // An IPC close error from an already-released child must not crash the parent.
      child.on("error", () => {});
    };
    try {
      child.send(command);
    } catch {
      try {
        error();
      } finally {
        this.stop();
      }
    }
  }
  stop() {
    this.generation++;
    this.cancelRetry();
    const child = this.child;
    this.child = undefined;
    this.detach?.();
    this.detach = undefined;
    if (!child) return;
    try {
      if (child.connected) child.send({ type: "stop" });
    } catch {
      /* IPC may already be closed. */
    } finally {
      child.kill();
    }
  }
}
