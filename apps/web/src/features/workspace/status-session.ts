import { AdminRequestError } from "../../lib/admin-client.ts";

export interface StatusSessionState<T> {
  phase: "checking" | "signed_in" | "signed_out" | "unavailable";
  data?: T;
  failed: boolean;
  error: string;
}

/** Owns one status request and its polling lifetime; old credentials cannot revive data. */
export class StatusSession<T> {
  private current: StatusSessionState<T> = {
    phase: "checking",
    failed: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private active = false;
  constructor(
    private readonly load: (signal: AbortSignal) => Promise<T>,
    private readonly intervalMs = 2000,
  ) {}
  snapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: StatusSessionState<T>) {
    this.current = state;
    for (const listener of this.listeners) listener();
  }
  start() {
    this.active = true;
    void this.refresh();
  }
  stop() {
    this.active = false;
    this.cancel();
  }
  private cancel() {
    this.revision++;
    this.controller?.abort();
    clearTimeout(this.timer);
  }
  signOut() {
    this.cancel();
    this.publish({ phase: "signed_out", failed: false, error: "" });
  }
  refresh = async () => {
    if (!this.active) return;
    this.cancel();
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const data = await this.load(controller.signal);
      if (!this.active || revision !== this.revision) return;
      this.publish({ phase: "signed_in", data, failed: false, error: "" });
    } catch (error) {
      if (!this.active || revision !== this.revision) return;
      if (error instanceof AdminRequestError && error.unauthorized) {
        this.publish({ phase: "signed_out", failed: false, error: "" });
      } else {
        this.publish({
          ...this.current,
          phase: this.current.data ? "signed_in" : "unavailable",
          failed: true,
          error:
            error instanceof Error
              ? error.message
              : "상태를 확인하지 못했습니다.",
        });
      }
    } finally {
      if (
        this.active &&
        revision === this.revision &&
        this.current.phase !== "signed_out"
      )
        this.timer = setTimeout(() => void this.refresh(), this.intervalMs);
    }
  };
}
