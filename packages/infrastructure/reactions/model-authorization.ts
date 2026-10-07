import { ModelAuthorization } from "../../application/reactions/model-authorization.ts";
import type { Store } from "../../storage.ts";
import type { Capture } from "../inputs/screen-input.ts";
import type { Transcriber } from "../inputs/speech-input.ts";
export function createModelAuthorization(options: {
  store: Store;
  capture: Capture;
  transcriber: Transcriber;
  sessionOpen(): boolean;
}) {
  const { store, capture, transcriber } = options;
  const authorization = new ModelAuthorization({
    sessionOpen: options.sessionOpen,
    frame: (id) =>
      capture.has(id)
        ? capture.frames.find((frame) => frame.id === id)
        : undefined,
    transcripts: () => transcriber.recent(),
    message: (id) => {
      const message = store.publicMessage(id);
      return message ? { text: message.text.slice(0, 500) } : undefined;
    },
  });
  return {
    authorize: authorization.authorize,
  };
}
