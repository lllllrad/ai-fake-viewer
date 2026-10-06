import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAdminClient,
  AdminRequestError,
} from "../apps/web/src/lib/admin-client.ts";

const fake = (handler: (url: string, init: RequestInit) => Promise<Response>) =>
  handler as typeof fetch;
test("admin transport uses same-origin cookies and explicit mutation identities without persisting tokens", async () => {
  const calls: RequestInit[] = [];
  const client = createAdminClient(
    fake(async (url, init) => {
      assert.equal(url, "/api/admin/example");
      calls.push(init);
      return Response.json({ ok: true });
    }),
  );
  await client.request("example");
  await client.request("example", { method: "POST", body: { enabled: true } });
  assert.equal(calls[0]!.credentials, "same-origin");
  assert.equal(new Headers(calls[0]!.headers).has("Idempotency-Key"), false);
  assert(new Headers(calls[1]!.headers).get("Idempotency-Key"));
  assert.equal(calls[1]!.body, JSON.stringify({ enabled: true }));
  assert.equal(new Headers(calls[1]!.headers).has("Authorization"), false);
});

test("admin errors preserve authentication status, structured codes and plain-text proxy fallbacks", async () => {
  for (const [response, status, code, message] of [
    [
      Response.json({ error: "Fixture denied" }, { status: 401 }),
      401,
      undefined,
      "Fixture denied",
    ],
    [
      Response.json(
        { error: { code: "quota", message: "Fixture quota" } },
        { status: 429 },
      ),
      429,
      "quota",
      "Fixture quota",
    ],
    [
      new Response("<html>proxy failure</html>", { status: 502 }),
      502,
      undefined,
      "요청을 처리하지 못했습니다. (502)",
    ],
  ] as const) {
    const client = createAdminClient(fake(async () => response));
    await assert.rejects(client.request("status"), (error: unknown) => {
      assert(error instanceof AdminRequestError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      assert.equal(error.unauthorized, status === 401);
      return true;
    });
  }
});

test("typed responses reject invalid payloads and requests cannot escape the admin namespace", async () => {
  let count = 0;
  const client = createAdminClient(
    fake(async () => {
      count++;
      return Response.json({ invalid: true });
    }),
  );
  await assert.rejects(
    client.json("status", {
      parse() {
        throw Error("invalid");
      },
    }),
    (e: unknown) =>
      e instanceof AdminRequestError && e.code === "invalid_response",
  );
  for (const path of [
    "../secret",
    "https://example.invalid/",
    "//example.invalid/",
  ])
    await assert.rejects(client.request(path));
  assert.equal(count, 1);
});

test("cancelled requests keep cancellation distinct from network failures", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createAdminClient(
    fake(async (_url, init) => {
      init.signal!.throwIfAborted();
      throw Error("Fixture network failure");
    }),
  );
  await assert.rejects(
    client.request("status", { signal: controller.signal }),
    (e: unknown) => e instanceof Error && e.name === "AbortError",
  );
  await assert.rejects(
    client.request("status"),
    (e: unknown) => e instanceof AdminRequestError && e.status === 0,
  );
});
