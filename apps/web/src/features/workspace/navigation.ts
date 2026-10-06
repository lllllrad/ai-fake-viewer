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
export function useWorkspaceNavigation() {
  const [page, setPage] = useState(() => workspacePage(location.hash));
  useEffect(() => {
    const changed = () => setPage(workspacePage(location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }, [page]);
  return page;
}
