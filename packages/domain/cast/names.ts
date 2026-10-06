export const normalizeName = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{Cf}\p{P}]/gu, "");
