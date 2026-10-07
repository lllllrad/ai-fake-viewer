import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatgptAuth } from "../packages/infrastructure/accounts/chatgpt-auth.ts";

test("PC07: Sign in with ChatGPT disconnect clears secrets before remote revocation and rejects a late refresh", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-retention-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "tokens");
  let refresh!: (r: Response) => void;
  let discovery!: (r: Response) => void;
  const request: typeof fetch = async (url) =>
    new Promise<Response>((r) => {
      if (String(url).endsWith("openid-configuration")) discovery = r;
      else refresh = r;
    });
  const auth = new ChatgptAuth("a".repeat(64), path, request);
  (auth as any).data.accounts = [
    {
      clientId: "fixture",
      subject: "synthetic",
      email: null,
      accessToken: "old",
      refreshToken: "refresh",
      idToken: null,
      expiresAt: 0,
      earliestRefreshAt: 0,
      scopes: ["chatgpt.tokens.use.direct"],
      model: "fixture-model",
    },
  ];
  (auth as any).data.active = "fixture";
  const pending = auth.access();
  const rejection = assert.rejects(pending);
  const disconnect = auth.disconnect();
  const clearedImmediately =
    auth.active?.accessToken === "" && auth.active?.refreshToken === "";
  discovery(Response.json({}, { status: 503 }));
  await disconnect;
  refresh(
    Response.json({
      access_token: "late",
      refresh_token: "late-refresh",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "chatgpt.tokens.use.direct",
    }),
  );
  await rejection;
  assert.equal(clearedImmediately, true);
  const restored = new ChatgptAuth("a".repeat(64), path, request);
  assert.equal(restored.active?.refreshToken, "");
  assert.equal(restored.active?.accessToken, "");
  assert.equal(restored.active?.idToken, null);
  assert.equal(restored.status.accounts[0].connected, false);
});

test("PC07: Sign in with ChatGPT rejects an authorization callback completed after sign-out", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-exchange-retention-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "tokens");
  let complete!: (response: Response) => void;
  const auth = new ChatgptAuth(
    "a".repeat(64),
    path,
    async () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    async () => ({ sub: "synthetic" }),
  );
  const login = new URL(auth.authorizationUrl(3210));
  const callback = auth.callback({
    state: login.searchParams.get("state")!,
    code: "code",
    client_id: "fixture",
  });
  const rejection = assert.rejects(callback);
  await auth.disconnect();
  complete(
    Response.json({
      access_token: "late",
      refresh_token: "late-refresh",
      id_token: "identity",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "resource.invoke offline_access chatgpt.tokens.use.direct",
    }),
  );
  await rejection;
  assert.equal(auth.active, null);
  assert.deepEqual(new ChatgptAuth("a".repeat(64), path).status.accounts, []);
});

test("model selection supersedes an in-flight account callback before it can persist", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "model-selection-retention-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "tokens");
  let complete!: (response: Response) => void;
  const auth = new ChatgptAuth(
    "a".repeat(64),
    path,
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    async () => ({ sub: "synthetic" }),
  );
  (auth as any).data.accounts = [
    {
      clientId: "fixture",
      subject: "synthetic",
      email: null,
      accessToken: "old",
      refreshToken: "refresh",
      idToken: null,
      expiresAt: 0,
      earliestRefreshAt: 0,
      scopes: ["chatgpt.tokens.use.direct"],
      model: "old-model",
    },
  ];
  (auth as any).data.active = "fixture";
  const login = new URL(auth.authorizationUrl(3210, "fixture"));
  const callback = auth.callback({
    state: login.searchParams.get("state")!,
    code: "fixture",
    client_id: "fixture",
  });
  const rejected = assert.rejects(callback, /authorization changed/);
  auth.setModel("new-model", ["new-model"]);
  complete(
    Response.json({
      access_token: "late",
      refresh_token: "late-refresh",
      id_token: "identity",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "resource.invoke offline_access chatgpt.tokens.use.direct",
    }),
  );
  await rejected;
  const restored = new ChatgptAuth("a".repeat(64), path);
  assert.equal(restored.active?.model, "new-model");
  assert.equal(restored.active?.accessToken, "old");
});
