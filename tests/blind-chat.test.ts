import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
import { Store } from "../packages/storage.ts";

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Timed out");
}

test("automatic AI posts and platform messages remain indistinguishable in live streams, reconnects and admin until reveal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mixed-blind-"));
  const config = configSchema.parse({
    database: ":memory:",
    ai: { visualMode: "on_request" },
  });
  assert.equal(config.ai.manualApproval, false);
  assert.equal(configSchema.parse({}).ai.manualApproval, false);
  const token = "a".repeat(64),
    reader = "r".repeat(64);
  const { app, store, scheduler, transcriber } = await createApp(config, {
    demo: true,
    startInputs: false,
    adminToken: token,
    readerToken: reader,
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(directory, "tokens"),
    chzzkTokenPath: join(directory, "chzzk.tokens"),
    soopTokenPath: join(directory, "soop.tokens"),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const host = `127.0.0.1:${config.port}`;
  const headers = { host, authorization: `Bearer ${token}` };
  const sockets: WebSocket[] = [];
  async function connect() {
    const messages: any[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/stream`, {
      origin: `http://${host}`,
      headers: { host },
    });
    sockets.push(socket);
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "auth", token: reader }));
    await waitFor(() => messages.length > 0);
    return messages;
  }
  try {
    const stream = await connect();
    const human = {
      platform: "youtube" as const,
      channel: "fixture",
      author: "private-account",
      name: "Human original",
      sourceId: "human-1",
      text: "새로운 장면이네요",
    };
    store.grantConsent(human.platform, human.channel, human.author);
    store.ingestBatch([human]);
    transcriber.transcripts.push({
      id: "speech",
      capturedAt: Date.now(),
      text: "장면이 바뀌었습니다",
    });
    scheduler.model = async () => ({
      decision: {
        action: "say",
        text: "장면이 바뀌었네요.",
        replyToMessageId: null,
        evidenceFrameIds: [],
        evidenceMessageIds: [],
        evidenceTranscriptIds: ["speech"],
      },
    });
    scheduler.state = "running";
    await scheduler.tick();
    assert.equal(scheduler.pending, undefined);
    assert.equal(store.usage().calls, 1);
    await waitFor(() => stream.length === 3);
    const visible = stream.slice(1).map((event) => event.event.payload);
    for (const m of visible) {
      assert.equal(m.attribution, "mixed");
      assert.match(m.displayName, /^시청자-[0-9a-f]{8}$/);
    }
    assert.notEqual(visible[0].displayName, visible[1].displayName);
    const adminStatus = (
      await app.inject({ url: "/api/admin/status", headers })
    ).json();
    assert.equal(adminStatus.ai.manualApproval, false);
    assert.equal(adminStatus.ai.pending, null);
    assert.deepEqual(adminStatus.messages, visible);
    const reconnect = await connect();
    assert.deepEqual(reconnect[0].messages, visible);
    // Internal attribution still controls model-context permissions.
    assert.equal(store.context(["youtube"]).length, 1);
    assert.equal(store.snapshot().messages[1]!.attribution, "experiment");
    store.ingestBatch([{ ...human, text: "수정된 메시지" }]);
    await waitFor(() => stream.length === 4);
    assert.equal(stream[3].event.type, "message.updated");
    assert.equal(stream[3].event.payload.displayName, visible[0].displayName);
    assert.equal(stream[3].event.payload.attribution, "mixed");
    for (const secret of [
      "Human original",
      "Orbit",
      "experiment",
      "youtube",
      "private-account",
    ])
      assert(!JSON.stringify(stream).includes(secret), secret);
    const reveal = await app.inject({
      method: "POST",
      url: "/api/admin/reveal",
      headers,
    });
    assert.equal(reveal.statusCode, 200);
    assert.equal(scheduler.state, "stopped");
    await waitFor(() => stream.length === 6);
    assert.equal(stream[4].event.type, "identity.revealed");
    assert.equal(stream[5].type, "snapshot");
    assert.equal(stream[5].messages[0].displayName, "Human original");
    assert.equal(stream[5].messages[1].attribution, "experiment");
    const revealedReconnect = await connect();
    assert.deepEqual(revealedReconnect[0].messages, stream[5].messages);
    assert.equal(
      (await app.inject({ url: "/api/admin/status", headers })).json()
        .messages[1].attribution,
      "experiment",
    );
    store.newSession();
    store.grantConsent(human.platform, human.channel, human.author);
    store.ingestBatch([human]);
    const nextSession = await connect();
    assert.equal(nextSession[0].messages[0].attribution, "mixed");
    assert.notEqual(
      nextSession[0].messages[0].displayName,
      visible[0].displayName,
    );
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind aliases and explicit reveal state survive database restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "mixed-blind-persist-"));
  const path = join(directory, "chat.sqlite");
  let store = new Store(path);
  try {
    store.ingestBatch([
      {
        platform: "experiment",
        channel: "fixture",
        author: "persona-0",
        name: "Orbit · experiment",
        text: "A reaction",
      },
    ]);
    const before = store.readerSnapshot().messages;
    store.close();
    store = new Store(path);
    assert.deepEqual(store.readerSnapshot().messages, before);
    store.reveal();
    store.close();
    store = new Store(path);
    assert.equal(store.readerSnapshot().messages[0].attribution, "experiment");
    assert.equal(store.readerSnapshot().messages[0].displayName, "Orbit");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
