import { decisionSchema } from "../../contracts/decision.ts";
import {
  decisionProblem,
  type DecisionEvidence,
} from "../../domain/reactions/decision.ts";
export function validateDecision<I extends DecisionEvidence>(
  raw: unknown,
  input: I,
) {
  const decision = decisionSchema.parse(raw);
  const problem = decisionProblem(decision, input);
  if (problem) throw new Error(problem);
  return decision;
}
