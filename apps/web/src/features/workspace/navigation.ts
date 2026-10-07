import { useEffect, useState } from "react";
export type WorkspacePage =
  "broadcast" | "connections" | "participation" | "records";
export function workspacePage(hash: string): WorkspacePage {
  const target = hash.replace(/^#/, "");
  if (
    [
      "connections",
      "program-details",
      "audio-details",
      "ai-details",
      "connection-details",
      "reader-links",
    ].includes(target)
  )
    return "connections";
  if (["participation", "privacy-panel", "operating-profile"].includes(target))
    return "participation";
  if (["records", "rights-requests", "video-inventory"].includes(target))
    return "records";
  return "broadcast";
}
let pendingTabHash: string | undefined;
export function navigateWorkspaceTab(target: string) {
  pendingTabHash = `#${target}`;
  // Updating a fragment directly lets the browser move focus to its target.
  // Tabs own focus, so publish the route without native fragment navigation.
  history.pushState(null, "", `#${target}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
export function useLocationHash() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return hash;
}
export function useWorkspaceNavigation(ready: boolean) {
  const hash = useLocationHash();
  const page = workspacePage(hash);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      // Only tab-trigger navigation preserves Radix focus; explicit deep links
      // still focus their destination, even if a tab was previously focused.
      const fromTab = pendingTabHash === hash;
      pendingTabHash = undefined;
      if (fromTab) return;
      const target =
        document.getElementById(hash.slice(1)) ?? document.getElementById(page);
      if (!target) return;
      const heading = target.querySelector<HTMLElement>("h1, h2, h3") ?? target;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, page, ready]);
  return page;
}
