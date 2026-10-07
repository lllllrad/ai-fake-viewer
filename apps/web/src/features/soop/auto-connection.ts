import type { SoopController } from "./controller.ts";
export interface SoopAutoInput {
  sessionId: string;
  enabled: boolean;
  stale: boolean;
  closed: boolean;
  state: string;
}
/** Automatic connection intent survives status polling, but not a new broadcast. */
export class SoopAutoConnection {
  private sessionId?: string;
  private paused = false;
  private retryAt = 0;
  constructor(
    private readonly controller: Pick<
      SoopController,
      "snapshot" | "connect" | "disconnect" | "dispose"
    >,
    private readonly now = () => Date.now(),
  ) {}
  sync(input: SoopAutoInput) {
    if (this.sessionId !== input.sessionId) {
      if (this.sessionId !== undefined) this.controller.dispose();
      this.sessionId = input.sessionId;
      this.paused = false;
      this.retryAt = 0;
    }
    if (input.stale) return;
    if (
      !input.enabled ||
      input.closed ||
      [
        "stopped",
        "disabled",
        "privacy_blocked",
        "auth_required",
        "config_required",
        "permission_blocked",
      ].includes(input.state)
    ) {
      if (
        ["connecting", "connected"].includes(this.controller.snapshot().phase)
      )
        this.controller.dispose();
      this.retryAt = 0;
      return;
    }
    if (
      this.paused ||
      ["connecting", "connected"].includes(this.controller.snapshot().phase) ||
      this.now() < this.retryAt
    )
      return;
    this.retryAt = this.now() + 30000;
    void this.controller.connect();
  }
  connect = () => {
    this.paused = false;
    this.retryAt = this.now() + 30000;
    return this.controller.connect();
  };
  disconnect = () => {
    this.paused = true;
    return this.controller.disconnect();
  };
}
