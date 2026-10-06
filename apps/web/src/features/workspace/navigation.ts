import { useEffect, useState } from "react";
export type WorkspacePage = "broadcast" | "connections" | "participation";
export function workspacePage(hash: string): WorkspacePage {
  const target = hash.replace(/^#/, "");
  if (
    [
      "connections",
      "program-details",
      "audio-details",
      "ai-details",
      "connection-details",
    ].includes(target)
  )
    return "connections";
  if (["participation", "privacy-panel"].includes(target))
    return "participation";
  return "broadcast";
}
export function useWorkspaceNavigation(ready: boolean) {
  const [hash, setHash] = useState(() => location.hash);
  const page = workspacePage(hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const target =
      document.getElementById(hash.slice(1)) ?? document.getElementById(page);
    if (!target) return;
    const heading = target.querySelector<HTMLElement>("h1, h2, h3") ?? target;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }, [hash, page, ready]);
  return page;
}
