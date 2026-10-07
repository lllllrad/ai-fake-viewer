import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";
import { adminStatusSchema } from "../packages/contracts/admin-status.ts";
for (const demo of [true, false])
  test(
    "administrator status projects dedicated media and model configuration: " +
      demo,
    async () => {
      const r = await createApp(
        configSchema.parse({
          database: ":memory:",
          input: { streamUrl: "rtmp://127.0.0.1/private-key" },
        }),
        {
          demo,
          startInputs: false,
          adminToken: "a".repeat(64),
          readerToken: "r".repeat(64),
          encryptionKey: "e".repeat(64),
          chatgptTokenPath: "/nonexistent/fixture-token",
        },
      );
      try {
        const response = await r.app.inject({
          url: "/api/admin/status",
          headers: {
            host: "127.0.0.1:3210",
            authorization: "Bearer " + "a".repeat(64),
          },
        });
        assert.equal(response.statusCode, 200);
        const status = adminStatusSchema.parse(response.json());
        assert.equal(status.demo, demo);
        assert.equal(status.inputMode, "ai_stream");
        assert.equal(status.capture.configured, true);
        for (const name of ["privacy", "connectors", "broadcastEnded"])
          assert.equal(name in status, false);
        assert.deepEqual(Object.keys(status.setup), ["audio", "ai"]);
        assert(!response.body.includes("private-key"));
      } finally {
        await r.app.close();
      }
    },
  );
