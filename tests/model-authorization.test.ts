import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ModelAuthorization,
  type AuthorizationInput,
  type ModelAuthorizationSource,
} from "../packages/application/reactions/model-authorization.ts";
import { StaleModelContextError } from "../packages/application/reactions/errors.ts";
import { SqliteModelAudience } from "../packages/infrastructure/reactions/model-audience.ts";
import { Store } from "../packages/storage.ts";
function fixture() {
  const frame = { id: "frame", capturedAt: 10, bytes: new Uint8Array([1, 2]) };
  const speech = { id: "speech", capturedAt: 10, text: "SYNTHETIC_SPEECH" };
  const message = { id: "message", text: "SYNTHETIC_CHAT" };
  const audience = { participantId: "participant", epoch: 1 };
  const attached: unknown[] = [];
  const source: ModelAuthorizationSource = {
    profileReady: () => true,
    sessionOpen: () => true,
    revision: () => 2,
    frame: () => frame,
    transcripts: () => [speech],
    message: () => message,
    audience: () => [audience],
    recordRequest: (id, request) => attached.push([id, request]),
    followup: (id, epoch, request) => attached.push([id, epoch, request]),
  };
  const input: AuthorizationInput = structuredClone({
    frames: [frame],
    messages: [message],
    newMessages: [message],
    transcripts: [speech],
    newTranscripts: [speech],
    privacyRevision: 2,
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
  "revision",
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
    if (changed === "revision") f.source.revision = () => 3;
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
test("request tracking retains authorized primitive identity and epoch after mutable context is cleared", () => {
  const f = fixture();
  f.service.authorize(f.input);
  f.audience.epoch = 2;
  f.input.messages = [];
  f.input.newMessages = [];
  f.service.requestId("request", f.input);
  assert.deepEqual(f.attached, [
    ["participant", "request"],
    ["participant", 1, "request"],
  ]);
  f.service.requestId("unknown", { ...f.input });
  assert.equal(f.attached.length, 2);
});
test("profile rejection and closed empty context cannot initiate provider work", () => {
  const f = fixture();
  f.source.profileReady = () => false;
  assert.throws(() => f.service.authorize(f.input));
  f.source.profileReady = () => true;
  f.source.sessionOpen = () => false;
  assert.throws(
    () => f.service.authorize({ privacyRevision: 2, frames: [], messages: [] }),
    StaleModelContextError,
  );
});
test("audience lookup respects platform, channel, visibility and broadcast identity", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  for (const channel of ["one", "two"]) {
    store.grantConsent("youtube", channel, "same-account");
    store.ingestBatch([
      {
        platform: "youtube",
        channel,
        author: "same-account",
        name: "Fixture",
        text: channel,
        sourceId: "fixture",
      },
    ]);
  }
  const messages = store
    .snapshot()
    .messages.filter((message) => message !== null);
  const participants = [
    {
      id: "one",
      epoch: 1,
      platform: "youtube",
      broadcaster: "one",
      author: "same-account",
    },
    {
      id: "two",
      epoch: 3,
      platform: "youtube",
      broadcaster: "two",
      author: "same-account",
    },
    {
      id: "other-platform",
      epoch: 1,
      platform: "chzzk",
      broadcaster: "one",
      author: "same-account",
    },
  ];
  const reader = new SqliteModelAudience(store.db, {
    sessionId: () => store.sessionId,
    participants: () => participants,
  });
  assert.deepEqual(reader.read([messages[0].id, messages[0].id]), [
    { participantId: "one", epoch: 1 },
  ]);
  store.hide(messages[0].id);
  assert.deepEqual(reader.read([messages[0].id]), []);
  store.db
    .prepare("UPDATE messages SET session='foreign' WHERE id=?")
    .run(messages[1].id);
  assert.deepEqual(reader.read([messages[1].id]), []);
});
