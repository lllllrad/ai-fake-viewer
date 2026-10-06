import { EncryptedTokenFile } from "../packages/infrastructure/accounts/encrypted-token-file.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatgptAuth } from "../packages/infrastructure/accounts/chatgpt-auth.ts";
import { chatgptModel } from "../packages/infrastructure/reactions/chatgpt-model.ts";
import { configSchema } from "../packages/config.ts";
const key = "e".repeat(64);
const response = {
  access_token: "access",
  refresh_token: "refresh",
  id_token: "identity",
  token_type: "Bearer",
  expires_in: 3600,
  scope:
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
};
test("ChatGPT OAuth uses PKCE, one-time state, verified identity and encrypted storage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-test-"));
  const path = join(dir, "tokens");
  const requests: { url: string; body: URLSearchParams }[] = [];
  const request = (async (url: any, init: any) => {
    requests.push({ url: String(url), body: new URLSearchParams(init.body) });
    return Response.json(response);
  }) as typeof fetch;
  let validated = 0;
  const verify = async (_token: string, clientId: string, nonce: string) => {
    assert.equal(clientId, "oaiapp_fixture");
    assert(nonce.length > 30);
    validated++;
    return { sub: "account-1", email: "user@example.test" };
  };
  try {
    const auth = new ChatgptAuth(key, path, request, verify);
    const url = new URL(auth.authorizationUrl(3210));
    assert.equal(url.origin, "https://auth.openai.com");
    assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://127.0.0.1:3210/oauth/chatgpt/callback",
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert(
      url.searchParams.get("scope")?.includes("chatgpt.tokens.use.direct"),
    );
    const state = url.searchParams.get("state")!;
    await assert.rejects(
      auth.callback({
        state: "wrong",
        code: "code",
        client_id: "oaiapp_fixture",
      }),
    );
    assert.equal(requests.length, 0);
    const second = new URL(auth.authorizationUrl(3210));
    await auth.callback({
      state: second.searchParams.get("state")!,
      code: "code",
      client_id: "oaiapp_fixture",
    });
    assert.equal(validated, 1);
    assert.equal(requests[0].body.get("client_id"), "oaiapp_fixture");
    assert.equal(
      requests[0].body.get("redirect_uri"),
      second.searchParams.get("redirect_uri"),
    );
    assert(!readFileSync(path).toString().includes("refresh"));
    assert.equal(
      new ChatgptAuth(key, path, request, verify).status.accounts[0].email,
      "user@example.test",
    );
    await assert.rejects(
      auth.callback({ state: second.searchParams.get("state")!, code: "code" }),
    );
    const reauth = new URL(auth.authorizationUrl(3210, "oaiapp_fixture"));
    assert.equal(reauth.searchParams.get("client_id"), "oaiapp_fixture");
    assert.equal(reauth.searchParams.get("agent_name_hint"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("ChatGPT inference requires completed stream and sends masked image with subscription flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-model-"));
  try {
    const auth = new ChatgptAuth(key, join(dir, "tokens")) as any;
    auth.data.accounts = [
      {
        clientId: "fixture",
        subject: "s",
        email: null,
        accessToken: "access",
        refreshToken: "refresh",
        idToken: null,
        expiresAt: Date.now() + 3600000,
        earliestRefreshAt: 0,
        scopes: ["chatgpt.tokens.use.direct"],
        model: "vision-fixture",
      },
    ];
    auth.data.active = "fixture";
    const input: any = {
      frames: [
        {
          id: "f",
          capturedAt: Date.now(),
          bytes: Buffer.from("image"),
          hash: "h",
        },
      ],
      messages: [],
      persona: { name: "test", style: "brief" },
      description: "fixture",
    };
    const decision = {
      action: "skip",
      text: null,
      replyToMessageId: null,
      evidenceFrameIds: [],
      evidenceMessageIds: [],
    };
    const completed = {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(decision) }],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    };
    let seen: any;
    const request = (async (_url: any, init: any) => {
      seen = JSON.parse(init.body);
      return new Response(`data: ${JSON.stringify(completed)}\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    const model = chatgptModel(configSchema.parse({}).ai, auth, request);
    const result = await model(input, new AbortController().signal);
    assert.equal(result.decision.action, "skip");
    assert.equal(seen.store, false);
    assert.equal(seen.stream, true);
    assert.equal(seen.input[1].content[1].detail, "high");
    assert.equal(seen.max_output_tokens, undefined);
    assert.equal(
      seen.input[1].content[1].image_url,
      "data:image/jpeg;base64,aW1hZ2U=",
    );
    const text = JSON.stringify(decision);
    const deltaOnly = chatgptModel(
      configSchema.parse({}).ai,
      auth,
      (async () =>
        new Response(
          [
            { type: "response.output_text.delta", delta: text.slice(0, 18) },
            { type: "response.output_text.delta", delta: text.slice(18) },
            {
              type: "response.completed",
              response: { status: "completed", output: [], usage: {} },
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        )) as typeof fetch,
    );
    assert.equal(
      (await deltaOnly(input, new AbortController().signal)).decision.action,
      "skip",
    );
    const interrupted = chatgptModel(
      configSchema.parse({}).ai,
      auth,
      (async () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"{}"}\n\n',
        )) as typeof fetch,
    );
    await assert.rejects(
      interrupted(input, new AbortController().signal),
      /before completion/,
    );
    for (const type of ["response.failed", "response.incomplete", "error"]) {
      let calls = 0;
      const failed = chatgptModel(configSchema.parse({}).ai, auth, async () => {
        calls++;
        return new Response(
          [
            {
              type: "response.output_text.delta",
              delta: JSON.stringify(decision),
            },
            { type, response: { status: "failed" } },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
        );
      });
      await assert.rejects(
        failed(input, new AbortController().signal),
        /failed or incomplete/,
      );
      assert.equal(calls, 1); // No alternate provider/account retry.
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const transition of ["account", "model", "authorization"] as const) {
  test(`ChatGPT ${transition} replacement owns a new refresh before the old one settles`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "chatgpt-refresh-owner-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "tokens");
    const account = (clientId: string) => ({
      clientId,
      subject: "fixture-subject",
      email: null,
      accessToken: "expired-fixture",
      refreshToken: "refresh-fixture",
      idToken: null,
      expiresAt: 0,
      earliestRefreshAt: 0,
      scopes: response.scope.split(" "),
      model: "model-fixture",
    });
    new EncryptedTokenFile(key, path, (value) => value).write({
      hostId: "urn:uuid:fixture",
      active: "first",
      accounts: [account("first"), account("second")],
    });
    const pending: Array<(response: Response) => void> = [];
    const clients: string[] = [];
    const auth = new ChatgptAuth(
      key,
      path,
      async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        if (body.get("grant_type") === "authorization_code")
          return Response.json({ ...response, expires_in: 1 });
        clients.push(body.get("client_id")!);
        return new Promise<Response>((resolve) => {
          pending.push(resolve);
        });
      },
      async () => ({ sub: "fixture-subject" }),
    );
    const authorization =
      transition === "authorization"
        ? new URL(auth.authorizationUrl(3210, "first"))
        : undefined;
    const old = auth.access();
    const retired = assert.rejects(old, /changed/);
    assert.equal(pending.length, 1);
    if (transition === "account") auth.select("second");
    else if (transition === "model") auth.setModel("new-model", ["new-model"]);
    else
      await auth.callback({
        state: authorization!.searchParams.get("state")!,
        code: "fixture-code",
      });
    const current = auth.access();
    assert.equal(pending.length, 2);
    assert.equal(clients[1], transition === "account" ? "second" : "first");
    pending[0](Response.json({ ...response, access_token: "retired-access" }));
    await retired;
    const shared = auth.access();
    assert.equal(pending.length, 2);
    pending[1](Response.json({ ...response, access_token: "current-access" }));
    assert.deepEqual(await Promise.all([current, shared]), [
      "current-access",
      "current-access",
    ]);
    assert.equal(auth.active?.accessToken, "current-access");
    assert.equal(
      new ChatgptAuth(key, path).active?.accessToken,
      "current-access",
    );
    if (transition === "model") assert.equal(auth.active?.model, "new-model");
  });
}
