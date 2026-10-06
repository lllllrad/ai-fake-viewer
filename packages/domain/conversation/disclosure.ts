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
