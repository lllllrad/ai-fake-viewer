import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { DisplayConversation } from "../packages/infrastructure/conversation/display-conversation.ts";
import { normalizeYoutube } from "../packages/infrastructure/platforms/youtube-chat-payload.ts";
import { normalizeChzzk } from "../packages/infrastructure/platforms/chzzk-chat-payload.ts";
import type { DisplayChat } from "../packages/contracts/display-chat.ts";
import { displayChatSettingsSchema } from "../packages/contracts/display-chat.ts";
import { DisplayChatConnections } from "../packages/infrastructure/platforms/display-chat.ts";
import {
  receiveConversation,
  emptyConversation,
} from "../apps/web/src/features/conversation/state.ts";
import {
  conversationPacketSchema,
  type PublicEvent,
} from "../packages/contracts/conversation.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const viewer = (
  platform: DisplayChat["platform"],
  sourceId = "source",
): DisplayChat => ({
  platform,
  channel: "fixture",
  sourceId,
  author: "PRIVATE_ID",
  name: "실제 시청자",
  text: "PRIVATE_VIEWER_BODY",
});
test("all platform chats appear only in the display projection, leaving every AI input unchanged", (t) => {
  const store = new Store(":memory:"),
    display = new DisplayConversation(store);
  t.after(() => {
    display.close();
    store.close();
  });
  const before = {
    snapshot: store.snapshot(),
    context: store.context(["experiment", "youtube", "chzzk", "soop"]),
    seq: store.lastSeq(),
    summary: store.chatSummary(),
  };
  let invalidated = 0;
  store.on("context_invalidated", () => invalidated++);
  store.on("reset", () => invalidated++);
  for (const p of ["youtube", "chzzk", "soop"] as const)
    assert(display.receive(viewer(p)));
  assert.equal(display.snapshot().messages.length, 3);
  assert.deepEqual(
    {
      snapshot: store.snapshot(),
      context: store.context(["experiment", "youtube", "chzzk", "soop"]),
      seq: store.lastSeq(),
      summary: store.chatSummary(),
    },
    before,
  );
  assert.equal(store.db.prepare("SELECT count(*) n FROM messages").get()!.n, 0);
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM actors_private").get()!.n,
    0,
  );
  const id = display.snapshot().messages[0]!.id;
  assert(display.hide(id));
  assert.equal(invalidated, 0);
  assert.equal(
    display.receive(viewer("youtube")),
    false,
    "hidden replay must not resurrect the message",
  );
});
test("reader events interleave synthetic and platform chat without sequence collisions or stale resurrection", (t) => {
  const store = new Store(":memory:"),
    display = new DisplayConversation(store);
  t.after(() => {
    display.close();
    store.close();
  });
  let state = receiveConversation(
    emptyConversation(),
    conversationPacketSchema.parse({ ...display.snapshot(), demo: false }),
  );
  let cached: PublicEvent | undefined;
  display.subscribe({
    event: (e) => {
      cached = e;
      state = receiveConversation(
        state,
        conversationPacketSchema.parse({
          type: "event",
          event: display.event(e),
        }),
      );
    },
    reset: () => {
      state = receiveConversation(
        state,
        conversationPacketSchema.parse({ ...display.snapshot(), demo: false }),
      );
    },
  });
  display.receive(viewer("youtube"));
  const old = cached!;
  const ai = store.publishSynthetic({
    actor: "synthetic",
    name: "AI Viewer",
    text: "AI_BODY",
    replyToId: null,
    sourceMessageIds: [],
  });
  assert(ai);
  display.receive(viewer("chzzk"));
  assert.deepEqual(
    state.messages.map((m) => m.text),
    ["PRIVATE_VIEWER_BODY", "AI_BODY", "PRIVATE_VIEWER_BODY"],
  );
  assert.equal(new Set(state.messages.map((m) => m.seq)).size, 3);
  display.hide((old.payload as { id: string }).id);
  assert.equal(display.event(old).type, "message.hidden");
  store.hide(ai);
  assert.equal(state.messages.length, 1);
  store.closeSession();
  assert(state.closed);
  assert.equal(state.messages.length, 0);
  assert.equal(display.receive(viewer("soop")), false);
  store.newSession();
  assert.equal(display.snapshot().messages.length, 0);
});
test("display history is bounded, memory-only and disclosure keeps real names", (t) => {
  const store = new Store(":memory:"),
    display = new DisplayConversation(store);
  t.after(() => {
    display.close();
    store.close();
  });
  for (let i = 0; i < 350; i++) display.receive(viewer("youtube", String(i)));
  assert.equal(display.snapshot().messages.length, 300);
  store.reveal();
  assert.equal(display.snapshot().messages[0]!.displayName, "실제 시청자");
  assert.equal(display.snapshot().messages[0]!.attribution, "youtube");
  display.close();
  const restarted = new DisplayConversation(store);
  assert.equal(restarted.snapshot().messages.length, 0);
  restarted.close();
});
test("YouTube and CHZZK normalize into display contracts without enabling AI ingestion", () => {
  const yt = normalizeYoutube(
    {
      id: "message-id",
      snippet: { type: "textMessageEvent", displayMessage: "hello" },
      authorDetails: { channelId: "author", displayName: "Viewer" },
    },
    "channel",
  );
  assert.equal(yt?.platform, "youtube");
  assert.equal(yt?.text, "hello");
  const chzzk = normalizeChzzk({
    channelId: "channel",
    senderChannelId: "author",
    profile: { nickname: "Viewer" },
    content: "hello",
    messageTime: 1,
  });
  assert.equal(chzzk.platform, "chzzk");
  assert.equal(chzzk.text, "hello");
});
test("SOOP bridge accepts only its active connection, deduplicates and ignores late callbacks after stop", async (t) => {
  const store = new Store(":memory:"),
    display = new DisplayConversation(store);
  const priorId = process.env.SOOP_CLIENT_ID,
    priorSecret = process.env.SOOP_CLIENT_SECRET;
  process.env.SOOP_CLIENT_ID = "fixture";
  process.env.SOOP_CLIENT_SECRET = "fixture";
  const gateway = new DisplayChatConnections(
    displayChatSettingsSchema.parse({
      soop: { enabled: true, streamerId: "fixture" },
    }),
    "e".repeat(64),
    {
      session: () => store.sessionId,
      closed: () => store.closed(),
      receive: (m) => display.receive(m),
      port: 3210,
      demo: false,
    },
  );
  t.after(async () => {
    await gateway.close();
    display.close();
    store.close();
    if (priorId === undefined) delete process.env.SOOP_CLIENT_ID;
    else process.env.SOOP_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.SOOP_CLIENT_SECRET;
    else process.env.SOOP_CLIENT_SECRET = priorSecret;
  });
  gateway.soop.access = async () => "fixture-token";
  const auth = await gateway.soopSession();
  gateway.soopStatus("subscribed", auth.broadcastId);
  const body = {
    broadcastId: auth.broadcastId,
    sourceId: crypto.randomUUID(),
    userId: "viewer",
    userNickname: "Viewer",
    message: "PRIVATE_BODY",
  };
  gateway.soopMessage(body);
  gateway.soopMessage(body);
  assert.equal(display.snapshot().messages.length, 1);
  assert.equal(store.lastSeq(), 0);
  await gateway.stop("soop");
  assert.throws(() => gateway.soopMessage(body));
  assert.equal(gateway.status().platforms.soop.state, "stopped");
});
test("unreadable platform tokens cannot stop AI storage or overwrite the original credentials", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "display-credentials-"));
  for (const platform of ["youtube", "chzzk", "soop"])
    writeFileSync(join(dir, platform + ".tokens"), "invalid fixture");
  const gateway = new DisplayChatConnections(
    displayChatSettingsSchema.parse({
      youtube: { enabled: true },
      chzzk: { enabled: true },
      soop: { enabled: true },
    }),
    "e".repeat(64),
    {
      session: () => "fixture",
      closed: () => false,
      receive: () => true,
      port: 3210,
      demo: false,
      directory: dir,
    },
  );
  t.after(async () => {
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const platform of ["youtube", "chzzk", "soop"] as const) {
    assert.equal(gateway.status().platforms[platform].state, "auth_failed");
    assert.equal(
      readFileSync(join(dir, platform + ".tokens"), "utf8"),
      "invalid fixture",
    );
  }
});
