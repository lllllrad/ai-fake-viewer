import { useEffect, useState, useSyncExternalStore } from "react";
import { adminClient } from "../../lib/admin-client.ts";
import { normalizeAdminStatus } from "../../operations-dashboard.tsx";
import { StatusSession } from "./status-session.ts";

// Status projection moves to a validated shared DTO with the replacement workspace.
const statusDecoder = {
  parse(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid status");
    return normalizeAdminStatus(value);
  },
};
export function useAdminSession() {
  const [owner] = useState(
    () =>
      new StatusSession((signal) =>
        adminClient.json("status", statusDecoder, { signal }),
      ),
  );
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  useEffect(() => {
    owner.start();
    return () => owner.stop();
  }, [owner]);
  return { ...state, refresh: owner.refresh, signOut: () => owner.signOut() };
}
