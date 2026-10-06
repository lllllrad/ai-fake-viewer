import { useEffect, useState, useSyncExternalStore } from "react";
import { adminClient } from "../../lib/admin-client.ts";
import { adminStatusSchema } from "../../../../../packages/contracts/admin-status.ts";
import { StatusSession } from "./status-session.ts";

export function useAdminSession() {
  const [owner] = useState(
    () =>
      new StatusSession((signal) =>
        adminClient.json("status", adminStatusSchema, { signal }),
      ),
  );
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  useEffect(() => {
    owner.start();
    return () => owner.stop();
  }, [owner]);
  return { ...state, refresh: owner.refresh, signOut: () => owner.signOut() };
}
