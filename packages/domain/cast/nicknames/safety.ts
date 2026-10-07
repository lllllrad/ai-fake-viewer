/** Product-owned nickname vocabulary policy, not a classifier for viewer messages. */
const prohibited = [
  "씨발",
  "시발",
  "씨팔",
  "시팔",
  "병신",
  "개새끼",
  "좆",
  "씹",
  "보지",
  "자지",
  "자위",
  "섹스",
  "강간",
  "로리",
  "죽어",
  "자살",
  "한남충",
  "한녀충",
  "김치녀",
  "된장녀",
  "fuck",
  "shit",
  "bitch",
  "nigger",
  "nigga",
  "cunt",
  "porn",
  "ssibal",
  "sibal",
  "byeongsin",
  "tlqkf",
  "qudtls",
];
const sensitiveCombinations = ["젖은조개", "젖은버섯", "커다란자지"];
const fold = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/gu, "");

export function appropriateNickname(value: string): boolean {
  const key = fold(value);
  const letters = key.replace(
    /[013457]/g,
    (digit) =>
      ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" })[digit]!,
  );
  // Check both forms; numeric suffixes must not conceal a prohibited root.
  return ![key, letters].some(
    (form) =>
      [...prohibited, ...sensitiveCombinations].some((term) =>
        form.includes(term),
      ) || /^(?:sex|ass|nazi)\d*$/.test(form),
  );
}
