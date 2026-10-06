import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  SoopBridge,
  SoopBridgeError,
  type SoopBridgePorts,
  type SoopBridgeSettings,
} from "../packages/application/inputs/soop-bridge.ts";
import { registerSoopBridgeRoutes } from "../apps/server/http/routes/soop-bridge.ts";
function fixture() {
  const events: unknown[] = [];
  const settings: SoopBridgeSettings = {
    enabled: true,
    available: true,
    closed: false,
    broadcastId: "broadcast",
    streamerId: "owner",
    clientId: "client",
    clientSecret: "secret",
    state: "subscribed",
  };
  const ports: SoopBridgePorts = {
    settings: () => ({ ...settings }),
    access: async () => "synthetic-token",
    status: (state) => {
      settings.state = state;
      events.push(["status", state]);
    },
    connectionLost: () => {
      events.push("lost");
    },
    receive: (message) => {
      events.push(["message", message]);
    },
    notices: {
      reset: () => {
        events.push("reset");
      },
      next: (connected) => {
        events.push(["next", connected]);
        return connected
          ? { id: "notice", text: "fixed", expiresAt: 100 }
          : null;
      },
      state: () => "fixture",
      failed: (id) => {
        events.push(["failed", id]);
      },
      echo: (author, text) => {
        events.push(["echo", author, text]);
      },
    },
  };
  return { bridge: new SoopBridge(ports), ports, events, settings };
}
test("SOOP bridge returns only the browser SDK session fields", async () => {
  const f = fixture();
  assert.deepEqual(await f.bridge.session(), {
    clientId: "client",
    accessToken: "synthetic-token",
    streamerId: "owner",
  });
});
for (const change of [
  "closed",
  "broadcast",
  "streamer",
  "credentials",
] as const) {
  test(
    "pending SOOP credential response is discarded after " +
      change +
      " changes",
    async () => {
      const f = fixture();
      let finish!: (token: string) => void;
      f.ports.access = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      const response = f.bridge.session();
      if (change === "closed") f.settings.closed = true;
      if (change === "broadcast") f.settings.broadcastId = "next";
      if (change === "streamer") f.settings.streamerId = "other";
      if (change === "credentials") f.settings.clientSecret = "replacement";
      finish("late-secret");
      await assert.rejects(response, SoopBridgeError);
      assert.deepEqual(f.events, []);
    },
  );
}
test("late credential failure does not overwrite a new broadcast's status", async () => {
  const f = fixture();
  let fail!: (error: Error) => void;
  f.ports.access = () =>
    new Promise((_resolve, reject) => {
      fail = reject;
    });
  const response = f.bridge.session();
  f.settings.broadcastId = "next";
  fail(new Error("private provider response"));
  await assert.rejects(response, /Authorize SOOP/);
  assert.deepEqual(f.events, []);
});
test("current credential failure reports authorization required without provider details", async () => {
  const f = fixture();
  f.ports.access = async () => {
    throw new Error("private provider response");
  };
  await assert.rejects(f.bridge.session(), /Authorize SOOP/);
  assert.deepEqual(f.events, [["status", "auth_required"]]);
});
test("non-subscribed reports invalidate notice delivery before changing receiver state", () => {
  const f = fixture();
  f.bridge.report("disconnected");
  assert.deepEqual(f.events, ["reset", "lost", ["status", "disconnected"]]);
  f.events.length = 0;
  f.bridge.report("subscribed");
  assert.deepEqual(f.events, [["status", "subscribed"]]);
});
test("closed broadcast rejects browser status and chat, and cannot issue notices", async () => {
  const f = fixture();
  f.settings.closed = true;
  assert.throws(() => f.bridge.report("subscribed"), SoopBridgeError);
  assert.throws(
    () =>
      f.bridge.receive({
        userId: "viewer",
        userNickname: "Viewer",
        message: "hello",
      }),
    SoopBridgeError,
  );
  await assert.rejects(f.bridge.session(), SoopBridgeError);
  assert.equal(f.bridge.nextNotice().notice, null);
  assert.deepEqual(f.events, [["next", false]]);
});
test("broadcaster messages only reach echo confirmation; viewers enter the ingestion pipeline", () => {
  const f = fixture();
  f.bridge.receive({
    userId: "owner",
    userNickname: "Owner",
    message: "fixed",
  });
  f.bridge.receive({
    userId: "viewer",
    userNickname: "Viewer",
    message: "hello",
  });
  assert.deepEqual(f.events, [
    ["echo", "owner", "fixed"],
    [
      "message",
      {
        platform: "soop",
        channel: "owner",
        author: "viewer",
        name: "Viewer",
        text: "hello",
        sourceId: null,
      },
    ],
  ]);
  f.settings.state = "disconnected";
  assert.throws(
    () =>
      f.bridge.receive({
        userId: "viewer",
        userNickname: "Viewer",
        message: "late",
      }),
    SoopBridgeError,
  );
  assert.equal(f.events.length, 2);
});
test("HTTP bridge validates viewer messages before ingestion and retains endpoint shapes", async () => {
  const f = fixture(),
    app = Fastify();
  registerSoopBridgeRoutes(app, f.bridge);
  try {
    const response = await app.inject("/api/admin/soop/chat-session");
    assert.equal(response.statusCode, 200);
    assert(!response.body.includes("clientSecret"));
    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/soop/message",
      payload: { userId: "viewer", message: "hello" },
    });
    assert(invalid.statusCode >= 400);
    assert.deepEqual(f.events, []);
    const valid = await app.inject({
      method: "POST",
      url: "/api/admin/soop/message",
      payload: { userId: "viewer", userNickname: "Viewer", message: " hello " },
    });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(valid.json(), { ok: true });
    const notice = await app.inject({
      method: "POST",
      url: "/api/admin/soop/notices/next",
    });
    assert.equal(notice.json().notice.text, "fixed");
  } finally {
    await app.close();
  }
});
