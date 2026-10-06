import { ModelAuthorization } from "../../application/reactions/model-authorization.ts";
import type { Store } from "../../storage.ts";
import type { Capture } from "../inputs/screen-input.ts";
import type { Transcriber } from "../inputs/speech-input.ts";
import type { ParticipationService } from "../../application/participation/service.ts";
import type { WithdrawalFollowups } from "../../application/rights/withdrawal-followups.ts";
import { SqliteModelAudience } from "./model-audience.ts";
export function createModelAuthorization(options: {
  store: Store;
  capture: Capture;
  transcriber: Transcriber;
  participation?: ParticipationService;
  followups: WithdrawalFollowups;
  profileReady(): boolean;
  sessionOpen(): boolean;
}) {
  const { store, capture, transcriber, participation, followups } = options;
  const audience = new SqliteModelAudience(store.db, {
    sessionId: () => store.sessionId,
    participants: () => participation?.participants.values() ?? [],
  });
  const authorization = new ModelAuthorization({
    profileReady: options.profileReady,
    sessionOpen: options.sessionOpen,
    revision: () => participation?.revision,
    frame: (id) =>
      capture.has(id)
        ? capture.frames.find((frame) => frame.id === id)
        : undefined,
    transcripts: () => transcriber.recent(),
    message: (id) => {
      const message = store.publicMessage(id);
      return message ? { text: message.text.slice(0, 500) } : undefined;
    },
    audience: (ids) => audience.read(ids),
    recordRequest: (id, requestId) => {
      participation?.recordRequest(id, requestId);
    },
    followup: (id, epoch, requestId) =>
      followups.requestReturned(id, epoch, requestId),
  });
  return {
    authorize: authorization.authorize,
    requestId: authorization.requestId,
  };
}
