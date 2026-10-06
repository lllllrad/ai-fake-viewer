import { useEffect, useMemo, useSyncExternalStore } from "react";
import { adminClient } from "../../lib/admin-client.ts";
import { PreviewSession } from "./preview-session.ts";

export function usePreview(enabled: boolean, broadcastId: string | undefined) {
  const owner = useMemo(
    () =>
      new PreviewSession(
        async (signal) =>
          (await adminClient.request("preview", { signal })).blob(),
        {
          create: (blob) => URL.createObjectURL(blob),
          revoke: (url) => URL.revokeObjectURL(url),
        },
      ),
    [broadcastId],
  );
  const url = useSyncExternalStore(owner.subscribe, owner.snapshot);
  useEffect(() => {
    if (enabled) owner.start();
    else owner.stop();
    return () => owner.stop();
  }, [owner, enabled]);
  return enabled ? url : "";
}
