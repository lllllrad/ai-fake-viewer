export interface Resolution {
  state: string;
  appDone: boolean;
  providerDone: boolean;
  videoDone: boolean;
  copiesDone: boolean;
  outcome: string;
}
export function resolutionProblem(
  value: Resolution,
): "actions_incomplete" | "limitation_missing" | undefined {
  if (
    value.state === "completed" &&
    (!value.appDone ||
      !value.providerDone ||
      !value.videoDone ||
      !value.copiesDone ||
      value.outcome === "pending")
  )
    return "actions_incomplete";
  if (value.state === "limited" && value.outcome !== "outside_control")
    return "limitation_missing";
}
export function canRemoveRightsRecord(state: string) {
  return state === "completed" || state === "limited";
}
