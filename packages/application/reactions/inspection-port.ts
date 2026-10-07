import type { CastRuntime } from "../../contracts/cast-runtime.ts";
import type { Decision } from "../../contracts/decision.ts";
/** Serializable host observations; the service decides how its algorithm presents state. */
export interface InspectionContext {
  members: CastRuntime["members"];
  state: string;
  busy: boolean;
  diagnostics: Array<{
    at: number;
    event: string;
    phase: string;
    details: Record<string, string | number>;
  }>;
  pending?: { memberId?: string; decision: Decision };
}
