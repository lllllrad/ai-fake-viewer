import type { ReactionPolicy } from "./cast-selection.ts";
export interface DispatchActivity {
  synthetic: number;
  reservations: number;
  globalGapCount: number;
  memberCooldownCount: number;
  inflight: number;
  latestAuthors: string[];
  memberAuthor: string;
  evidenceAvailable: boolean;
  proposed: string;
  priorTexts: string[];
}
function normalized(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{Cf}\p{P}]/gu, "");
}
/** Final pacing includes outstanding reservations, unlike the initial selection pass. */
export function dispatchAllowed(
  policy: ReactionPolicy & { max_inflight_per_session?: number },
  activity: DispatchActivity,
) {
  const cap = policy.global_hard_cap_messages_per_window ?? 6;
  const consecutiveLimit =
    policy.max_consecutive_messages_from_one_persona ?? 2;
  if (
    activity.synthetic + activity.reservations > cap ||
    activity.globalGapCount > 0 ||
    activity.memberCooldownCount > 0 ||
    activity.inflight > (policy.max_inflight_per_session ?? 2) ||
    (activity.latestAuthors.length >= consecutiveLimit &&
      activity.latestAuthors.every(
        (author) => author === activity.memberAuthor,
      )) ||
    !activity.evidenceAvailable ||
    !activity.proposed.trim()
  )
    return false;
  const proposed = normalized(activity.proposed);
  return (
    [...proposed].length < 12 ||
    !activity.priorTexts.some((text) => normalized(text) === proposed)
  );
}
