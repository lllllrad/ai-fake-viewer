/** Disclosure changes origin labels; platform nicknames never become pseudonyms. */
export function discloseMessage<
  T extends { displayName: string; attribution: string },
>(message: T, revealed: boolean): T {
  return {
    ...message,
    displayName:
      message.attribution === "experiment"
        ? message.displayName.replace(/\s*·\s*experiment\s*$/i, "").trim() ||
          "시청자"
        : message.displayName,
    attribution: revealed ? message.attribution : "mixed",
  };
}

/** Display collisions ignore Unicode variants, case, punctuation and spacing. */
export function collidingNames(names: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\s\p{Cf}\p{P}]/gu, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([key]) => key),
  );
}
