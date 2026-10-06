import type { Store } from "../../storage.ts";
export interface BroadcastInputScope {
  readonly broadcastId: string;
  readonly signal: AbortSignal;
  current(): boolean;
}
/** Cancel quiet streams as well as queued responses when their broadcast retires. */
export async function withBroadcastInput<T>(
  store: Store,
  signal: AbortSignal,
  run: (scope: BroadcastInputScope) => Promise<T>,
): Promise<T> {
  const broadcastId = store.sessionId;
  const controller = new AbortController();
  const current = () => store.sessionId === broadcastId && !store.closed();
  const changed = () => {
    if (!current()) controller.abort();
  };
  const scope = {
    broadcastId,
    signal: AbortSignal.any([signal, controller.signal]),
    current,
  };
  const event = (value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "session.closed"
    )
      changed();
  };
  store.on("reset", changed);
  store.on("event", event);
  try {
    changed();
    return await run(scope);
  } finally {
    store.off("reset", changed);
    store.off("event", event);
  }
}
