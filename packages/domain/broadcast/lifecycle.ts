export type BroadcastAvailability = {
  closed: boolean;
  shuttingDown: boolean;
  stoppingInputs: boolean;
};

export type BroadcastConflict = "closed" | "shutting_down" | "inputs_stopping";

/** Commands cannot race an input shutdown or reopen an ended broadcast. */
export function unavailableReason(
  state: BroadcastAvailability,
): BroadcastConflict | undefined {
  if (state.shuttingDown) return "shutting_down";
  if (state.stoppingInputs) return "inputs_stopping";
  if (state.closed) return "closed";
}

export function shouldRecoverAi(
  state: BroadcastAvailability & { requested: boolean; running: boolean },
) {
  return !unavailableReason(state) && state.requested && !state.running;
}
