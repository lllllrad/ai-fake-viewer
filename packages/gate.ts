import type { Config } from "./config.ts";
import { TimingGate } from "./application/reactions/timing-gate.ts";
import { TypeSafeTimingGate } from "./infrastructure/reactions/typesafe-gate.ts";

/** Compatibility composition for the optional timing provider. */
export class DecisionGate extends TimingGate {
  constructor(config: Config["ai"]["gate"], request: typeof fetch = fetch) {
    super(config, new TypeSafeTimingGate(request));
  }
}
