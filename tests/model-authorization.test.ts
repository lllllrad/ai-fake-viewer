import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ModelAuthorization,
  type AuthorizationInput,
  type ModelAuthorizationSource,
} from "../packages/application/reactions/model-authorization.ts";
import { StaleModelContextError } from "../packages/application/reactions/errors.ts";
import { Store } from "../packages/storage.ts";
function fixture() {
  const frame = { id: "frame", capturedAt: 10, bytes: new Uint8Array([1, 2]) };
  const speech = { id: "speech", capturedAt: 10, text: "SYNTHETIC_SPEECH" };
  const message = { id: "message", text: "SYNTHETIC_CHAT" };
  const audience = { participantId: "participant", epoch: 1 };
  const attached: unknown[] = [];
  const source: ModelAuthorizationSource = {
    sessionOpen: () => true,
    frame: () => frame,
    transcripts: () => [speech],
    message: () => message,
  };
  const input: AuthorizationInput = structuredClone({
    frames: [frame],
    messages: [message],
    newMessages: [message],
    transcripts: [speech],
    newTranscripts: [speech],
  });
  return {
    source,
    input,
    audience,
    attached,
    service: new ModelAuthorization(source),
  };
}
for (const changed of [
  "closed",
  "frame_bytes",
  "frame_time",
  "speech",
  "new_speech",
  "message",
  "new_message",
  "removed",
] as const)
  test(`provider reauthorization rejects stale ${changed} evidence`, () => {
    const f = fixture();
    f.service.authorize(f.input);
    if (changed === "closed") f.source.sessionOpen = () => false;
    if (changed === "frame_bytes") f.input.frames[0].bytes[1] = 3;
    if (changed === "frame_time") f.input.frames[0].capturedAt++;
    if (changed === "speech") f.input.transcripts![0].text = "EDITED";
    if (changed === "new_speech")
      f.input.newTranscripts = [
        { id: "speech", text: "EDITED", capturedAt: 10 },
      ];
    if (changed === "message") f.source.message = () => ({ text: "EDITED" });
    if (changed === "new_message")
      f.input.newMessages = [{ id: "message", text: "EDITED" }];
    if (changed === "removed") f.source.message = () => undefined;
    assert.throws(() => f.service.authorize(f.input), StaleModelContextError);
  });
test("closed empty context cannot initiate provider work", () => {
  const f = fixture();
  f.source.sessionOpen = () => false;
  assert.throws(
    () => f.service.authorize({ frames: [], messages: [] }),
    StaleModelContextError,
  );
});
