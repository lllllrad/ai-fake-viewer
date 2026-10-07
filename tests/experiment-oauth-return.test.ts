import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { ModelAccount } from "../packages/application/accounts/model-account.ts";
import { registerModelAccountRoutes } from "../apps/server/http/routes/model-account.ts";
for (const host of ["localhost", "127.0.0.1"])
  test(`test OAuth returns to ${host} UI only after successful callback`, async () => {
    const app = Fastify();
    let fail = false;
    registerModelAccountRoutes(
      app,
      new ModelAccount({
        authorizationUrl: () => "https://auth.example.invalid/authorize",
        activeAccount: () => null,
        models: async () => [],
        selectAccount() {},
        selectModel() {},
        callback: async () => {
          if (fail) throw Error("invalid state");
        },
        disconnect: async () => ({ revoked: false }),
        stopGeneration() {},
        invalidateContext() {},
      }),
      { port: 3211 },
    );
    try {
      await app.inject({
        method: "POST",
        url: "/api/admin/chatgpt/authorize",
        headers: { host: `${host}:3211` },
        payload: {},
      });
      const success = await app.inject({
        url: "/oauth/chatgpt/callback?code=fixture&state=fixture",
      });
      assert.equal(success.statusCode, 303);
      assert.equal(
        success.headers.location,
        `http://${host}:3211/admin#ai-connection`,
      );
      fail = true;
      const rejected = await app.inject({
        url: "/oauth/chatgpt/callback?error=access_denied",
      });
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.headers.location, undefined);
    } finally {
      await app.close();
    }
  });
