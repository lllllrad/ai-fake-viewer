import type { Store } from "../../storage.ts";
import type { NoticeSender } from "../../application/participation/notice-sender.ts";
import { withBroadcastInput } from "../inputs/broadcast-input.ts";
import { runChzzk, type ChzzkConnectionPorts } from "./chzzk-connection.ts";
export function runChzzkReceiver(
  store: Store,
  account: ChzzkConnectionPorts["account"],
  signal: AbortSignal,
  options: {
    worker: ChzzkConnectionPorts["worker"];
    notices?: Pick<NoticeSender, "resolve" | "reset">;
    status: ChzzkConnectionPorts["status"];
    recovered: ChzzkConnectionPorts["recovered"];
  },
) {
  return withBroadcastInput(store, signal, (scope) =>
    runChzzk(
      {
        account,
        worker: options.worker,
        available: (channel) =>
          scope.current() &&
          (!store.participation ||
            store.participation.available("chzzk", channel)),
        subscribed: (channel) => {
          if (scope.current()) options.notices?.resolve(channel, channel);
        },
        receive: (message) => {
          if (!scope.current() || scope.signal.aborted) return;
          try {
            store.ingestion.ingest([message]);
          } catch {
            if (scope.current()) options.status("invalid_event_rejected");
          }
        },
        status: (state, api) => {
          if (scope.current()) options.status(state, api);
        },
        recovered: () => {
          if (scope.current()) options.recovered();
        },
        reset: () => {
          if (scope.current()) options.notices?.reset();
        },
      },
      scope.signal,
    ),
  );
}
