export type MaintenanceTask = "retention" | "ai_recovery";
export interface MaintenanceEvent {
  task: MaintenanceTask;
  state: "failed" | "recovered";
}

/** Synchronous local maintenance cannot escape a timer or outlive storage. */
export class ServerMaintenance {
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private failed = new Set<MaintenanceTask>();
  constructor(
    private readonly dependencies: {
      purge(): void;
      recover(): void;
      report(event: MaintenanceEvent): void;
    },
  ) {}
  start() {
    if (this.stopped || this.timers.length) return;
    this.timers = [
      setInterval(
        () => this.run("retention", this.dependencies.purge),
        3600000,
      ),
      setInterval(
        () => this.run("ai_recovery", this.dependencies.recover),
        1000,
      ),
    ];
    for (const timer of this.timers) timer.unref();
  }
  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
  private run(task: MaintenanceTask, work: () => void) {
    if (this.stopped) return;
    try {
      work();
    } catch {
      if (!this.stopped && !this.failed.has(task)) {
        this.failed.add(task);
        this.report({ task, state: "failed" });
      }
      return;
    }
    if (!this.stopped && this.failed.delete(task))
      this.report({ task, state: "recovered" });
  }
  private report(event: MaintenanceEvent) {
    try {
      this.dependencies.report(event);
    } catch {
      // Logging cannot disable future retries or turn a handled failure into a crash.
    }
  }
}
