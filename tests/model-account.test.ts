import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  ModelAccount,
  AccountChangedError,
  type ModelAccountPorts,
} from "../packages/application/accounts/model-account.ts";
import { registerModelAccountRoutes } from "../apps/server/http/routes/model-account.ts";

function fixture() {
  const events: string[] = [];
  let active = "first";
  const ports: ModelAccountPorts = {
    authorizationUrl: () => "https://example.invalid/authorize",
    activeAccount: () => active,
    models: async () => [{ slug: "fixture-model", name: "Fixture" }],
    selectAccount: (id) => {
      active = id;
      events.push("select:" + id);
    },
    selectModel: (slug, available) => {
      assert(available.includes(slug));
      events.push("model:" + active + ":" + slug);
    },
    callback: async () => {
      active = "connected";
      events.push("callback");
    },
    disconnect: async () => {
      active = "";
      events.push("disconnect");
      return { revoked: true };
    },
    stopGeneration: () => {
      events.push("stop");
    },
    invalidateContext: () => {
      events.push("invalidate");
    },
  };
  return { account: new ModelAccount(ports), ports, events };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("selecting an account stops generation before selection and invalidates its context", () => {
  const f = fixture();
  f.account.selectAccount("second");
  assert.deepEqual(f.events, ["stop", "select:second", "invalidate"]);
});
test("late model selection cannot apply a previous account's available models", async () => {
  const f = fixture(),
    request = deferred<{ slug: string; name: string }[]>();
  f.ports.models = () => request.promise;
  const selection = f.account.selectModel("fixture-model");
  f.account.selectAccount("second");
  request.resolve([{ slug: "fixture-model", name: "Fixture" }]);
  await assert.rejects(selection, AccountChangedError);
  assert(!f.events.some((e) => e.startsWith("model:")));
});
test("a newer model selection supersedes the earlier pending selection", async () => {
  const f = fixture(),
    first = deferred<{ slug: string; name: string }[]>();
  f.ports.models = () => first.promise;
  const previous = f.account.selectModel("fixture-model");
  f.ports.models = async () => [{ slug: "new-model", name: "New" }];
  await f.account.selectModel("new-model");
  first.resolve([{ slug: "fixture-model", name: "Fixture" }]);
  await assert.rejects(previous, AccountChangedError);
  assert.deepEqual(
    f.events.filter((e) => e.startsWith("model:")),
    ["model:first:new-model"],
  );
});
test("model selection stops generation again after awaiting provider models", async () => {
  const f = fixture(),
    request = deferred<{ slug: string; name: string }[]>();
  f.ports.models = () => request.promise;
  const selection = f.account.selectModel("fixture-model");
  f.events.push("operator-restarted");
  request.resolve([{ slug: "fixture-model", name: "Fixture" }]);
  await selection;
  assert.deepEqual(f.events, [
    "stop",
    "operator-restarted",
    "model:first:fixture-model",
    "stop",
    "invalidate",
  ]);
});
test("model list reads cannot return stale choices after account changes", async () => {
  const f = fixture(),
    request = deferred<{ slug: string; name: string }[]>();
  f.ports.models = () => request.promise;
  const models = f.account.models();
  f.account.selectAccount("second");
  request.resolve([]);
  await assert.rejects(models, AccountChangedError);
});
test("disconnect invalidates pending selection and local context without waiting for revocation", async () => {
  const f = fixture(),
    request = deferred<{ slug: string; name: string }[]>(),
    remote = deferred<{ revoked: boolean }>();
  f.ports.models = () => request.promise;
  f.ports.disconnect = () => {
    f.events.push("local-secrets-cleared");
    return remote.promise;
  };
  const selection = f.account.selectModel("fixture-model");
  const disconnected = f.account.disconnect();
  assert.deepEqual(f.events, [
    "stop",
    "stop",
    "invalidate",
    "local-secrets-cleared",
  ]);
  request.resolve([{ slug: "fixture-model", name: "Fixture" }]);
  await assert.rejects(selection, AccountChangedError);
  remote.resolve({ revoked: false });
  assert.deepEqual(await disconnected, { revoked: false });
});
test("successful callback invalidates persisted account changes even if a newer command intervened", async () => {
  const f = fixture(),
    callback = deferred<void>();
  f.ports.callback = () => callback.promise;
  const completion = f.account.callback({ code: "fixture" });
  f.account.authorize();
  callback.resolve();
  await assert.rejects(completion, AccountChangedError);
  assert.deepEqual(f.events, ["stop", "invalidate"]);
});
test("failed callback does not claim an account change", async () => {
  const f = fixture();
  f.ports.callback = async () => {
    throw new Error("fixture failure");
  };
  await assert.rejects(f.account.callback({}));
  assert.deepEqual(f.events, []);
});
test("HTTP rejects malformed selection before effects and preserves callback content type", async () => {
  const f = fixture(),
    app = Fastify();
  registerModelAccountRoutes(app, f.account);
  try {
    const malformed = await app.inject({
      method: "POST",
      url: "/api/admin/chatgpt/select-account",
      payload: {},
    });
    assert(malformed.statusCode >= 400);
    assert.deepEqual(f.events, []);
    const selected = await app.inject({
      method: "POST",
      url: "/api/admin/chatgpt/select-model",
      payload: { slug: "fixture-model" },
    });
    assert.equal(selected.statusCode, 200);
    const callback = await app.inject("/oauth/chatgpt/callback?code=fixture");
    assert.equal(callback.statusCode, 200);
    assert.match(callback.headers["content-type"]!, /charset=utf-8/);
  } finally {
    await app.close();
  }
});
