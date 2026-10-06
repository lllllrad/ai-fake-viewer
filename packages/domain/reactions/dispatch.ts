import type { ReactionPolicy } from "./cast-selection.ts";
export interface DispatchActivity {
  upstream: number;
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
  const band = (policy.upstream_activity_bands ?? []).find(
    (b) =>
      activity.upstream >= b.min_messages &&
      (b.max_messages === null || activity.upstream <= b.max_messages),
  );
  const cap = Math.min(
    policy.global_hard_cap_messages_per_window ?? 6,
    band?.ai_cap_messages_per_window ?? 6,
  );
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
