import type { AutomaticCast } from "./automatic.ts";
import type { CastExecutionControl } from "./control.ts";
/** The live cast API contains no authoring, audition or operator approval operations. */
export class BroadcastCast {
  constructor(
    private readonly automatic: AutomaticCast,
    private readonly execution: CastExecutionControl,
    private readonly topic: () => string,
  ) {}
  prepare() {
    const id = this.automatic.ensure(this.topic());
    this.execution.ensureArmed(id);
    return id;
  }
  automaticSummary() {
    return this.automatic.summary();
  }
  stopActive(reason?: string) {
    return this.execution.stopActive(reason);
  }
}
