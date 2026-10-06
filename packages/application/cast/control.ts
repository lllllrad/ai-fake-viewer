import { ensure } from "./errors.ts";
export interface CastControlSnapshot {
  id: string;
  state: string;
  armed: boolean;
  revision: number;
  controlEpoch: number;
}
export interface CastControlRepository {
  transaction<T>(work: () => T): T;
  closed(): boolean;
  activeId(): string | undefined;
  read(id: string): CastControlSnapshot | undefined;
  arm(id: string, now: number): void;
  disarm(id: string, reason: string, now: number): void;
  audit(
    snapshot: CastControlSnapshot,
    action: "ai.armed" | "ai.stop",
    now: number,
    reason?: string,
  ): void;
}
/** Cast execution changes and attempt cancellation form one durable transition. */
export class CastExecutionControl {
  constructor(
    private readonly repository: CastControlRepository,
    private readonly now: () => number,
  ) {}
  ensureArmed(id: string) {
    this.repository.transaction(() => {
      ensure(!this.repository.closed(), "SESSION_CLOSED");
      const snapshot = this.repository.read(id);
      ensure(snapshot, "SESSION_NOT_FOUND");
      ensure(snapshot.state === "live", "STALE_CONTROL_EPOCH");
      if (!snapshot.armed) this.arm(id, snapshot.controlEpoch);
    });
  }
  arm(id: string, epoch: number) {
    this.repository.transaction(() => {
      ensure(!this.repository.closed(), "SESSION_CLOSED");
      const snapshot = this.repository.read(id);
      ensure(snapshot, "SESSION_NOT_FOUND");
      ensure(
        snapshot.state === "live" && snapshot.controlEpoch === epoch,
        "STALE_CONTROL_EPOCH",
      );
      const now = this.now();
      this.repository.arm(id, now);
      this.repository.audit(snapshot, "ai.armed", now);
    });
  }
  stop(id: string, reason = "emergency_stop") {
    this.repository.transaction(() => {
      const snapshot = this.repository.read(id);
      ensure(snapshot, "SESSION_NOT_FOUND");
      const now = this.now();
      this.repository.disarm(id, reason, now);
      this.repository.audit(snapshot, "ai.stop", now, reason);
    });
  }
  stopActive(reason = "emergency_stop") {
    return this.repository.transaction(() => {
      const id = this.repository.activeId();
      if (!id) return null;
      this.stop(id, reason);
      return id;
    });
  }
}
