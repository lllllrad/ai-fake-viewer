export const summaryWindowMs = 120_000;
export type ChatSummary = {
  version: 1;
  state: "available" | "insufficient_data";
  topics: string[];
  atmosphere: string[];
  activity: "unknown" | "quiet" | "active" | "busy";
};
const topics: Array<[string, RegExp]> = [
  ["게임·플레이", /게임|플레이|보스|레벨|공략|game|boss/i],
  ["제작·실험", /만들|제작|실험|조립|재료|작품/],
  ["개발·기술", /코드|코딩|개발|버그|오류|서버|프로그램|code|bug/i],
  ["음악·소리", /음악|노래|연주|박자|소리|music/i],
  ["음식·요리", /음식|요리|재료|레시피|맛있|먹/],
  ["방송 진행", /화면|음량|방송|마이크|자막/],
];
const atmosphere: Array<[string, RegExp]> = [
  ["질문이 오감", /[?？]|왜|어떻게|뭔가요|인가요/],
  ["웃음 표현", /ㅋ{2,}|ㅎ{2,}|웃기|웃겨|lol/i],
  ["응원 표현", /화이팅|파이팅|힘내|응원|잘했|축하/],
  ["놀람 표현", /대박|와[ !]|놀랍|신기/],
  ["어려움·혼란 표현", /어렵|모르겠|헷갈|안되|안 돼|실패/],
];
// Only fixed labels leave this module. Names, quotations, numbers, URLs and
// arbitrary entities are never extracted. Threshold applies to EACH label.
export function summarizeChat(
  rows: Array<{ actor: string; text: string }>,
): ChatSummary {
  const distinct = new Set(rows.map((row) => row.actor)).size;
  const labels = (rules: Array<[string, RegExp]>) =>
    rules
      .filter(
        ([, pattern]) =>
          new Set(
            rows
              .filter((row) => pattern.test(row.text))
              .map((row) => row.actor),
          ).size >= 3,
      )
      .map(([label]) => label);
  return {
    version: 1,
    state: distinct >= 3 ? "available" : "insufficient_data",
    topics: labels(topics),
    atmosphere: labels(atmosphere),
    activity:
      distinct < 3
        ? "unknown"
        : rows.length > 30
          ? "busy"
          : rows.length > 10
            ? "active"
            : "quiet",
  };
}

/** Durable summaries may retain approved labels, never arbitrary persisted text. */
export function retainApprovedSummary(
  previous: unknown,
  current: ChatSummary,
): ChatSummary {
  if (!previous || typeof previous !== "object") return current;
  const value = previous as Record<string, unknown>;
  if (
    value.version !== 1 ||
    value.state !== "available" ||
    !Array.isArray(value.topics) ||
    !Array.isArray(value.atmosphere)
  )
    return current;
  const approved = (input: unknown[], rules: Array<[string, RegExp]>) =>
    input.filter(
      (label): label is string =>
        typeof label === "string" &&
        rules.some(([allowed]) => allowed === label),
    );
  const activity = ["unknown", "quiet", "active", "busy"].includes(
    String(value.activity),
  )
    ? (value.activity as ChatSummary["activity"])
    : "unknown";
  return {
    version: 1,
    state: "available",
    activity,
    topics: [
      ...new Set([...approved(value.topics, topics), ...current.topics]),
    ],
    atmosphere: [
      ...new Set([
        ...approved(value.atmosphere, atmosphere),
        ...current.atmosphere,
      ]),
    ],
  };
}
