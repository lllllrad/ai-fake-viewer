import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { z } from "zod";
import { registerHttpErrors } from "../apps/server/http/errors.ts";
import { AiStartError } from "../packages/application/reactions/coordinator.ts";

test("HTTP errors expose reviewed action messages but omit validation values and adapter details", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerHttpErrors(app);
  app.get("/api/admin/action", async () => {
    throw new AiStartError("Wait for current input.");
  });
  app.get("/api/admin/validation", async () => {
    z.object({ count: z.number() }).parse({ count: "PRIVATE_FIXTURE" });
  });
  app.get("/api/admin/adapter", async () => {
    throw new Error("PRIVATE_FIXTURE");
  });
  app.get("/public", async () => {
    throw new Error("PRIVATE_FIXTURE");
  });
  const action = await app.inject("/api/admin/action");
  assert.equal(action.statusCode, 409);
  assert.deepEqual(action.json(), { error: "Wait for current input." });
  const validation = await app.inject("/api/admin/validation");
  assert.equal(validation.statusCode, 400);
  assert.deepEqual(validation.json(), { error: "Invalid request fields" });
  const adapter = await app.inject("/api/admin/adapter");
  assert.equal(adapter.statusCode, 400);
  assert.deepEqual(adapter.json(), {
    error:
      "Action unavailable. Check configuration, credentials, fresh frames and session state.",
  });
  const publicResponse = await app.inject("/public");
  assert.equal(publicResponse.statusCode, 400);
  assert.deepEqual(publicResponse.json(), { error: "Request failed" });
});
