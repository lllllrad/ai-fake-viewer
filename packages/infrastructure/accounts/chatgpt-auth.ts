import { AccountRefresh } from "../../application/accounts/refresh-flight.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EncryptedTokenFile } from "./encrypted-token-file.ts";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().positive(),
  scope: z.string(),
  earliest_refresh_at: z.union([z.number(), z.string()]).optional(),
});
const accountSchema = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().nullable(),
  accessToken: z.string(),
  refreshToken: z.string(),
  idToken: z.string().nullable(),
  expiresAt: z.number(),
  earliestRefreshAt: z.number(),
  scopes: z.array(z.string()),
  model: z.string().nullable(),
});
type Account = z.infer<typeof accountSchema>;
const stateSchema = z.object({
  hostId: z.string().startsWith("urn:uuid:"),
  active: z.string().nullable(),
  accounts: z.array(accountSchema),
});
type State = z.infer<typeof stateSchema>;
function refreshTime(value: number | string | undefined) {
  if (typeof value === "number") return value * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  redirect: string;
  clientId: string;
  expiresAt: number;
};
export class ChatgptAuth {
  private readonly file: EncryptedTokenFile<State>;
  private generation = 0;
  private data: State;
  private pending: Pending | null = null;
  private readonly refresh = new AccountRefresh<string>();
  constructor(
    key: string,
    path = "data/chatgpt.tokens",
    private request: typeof fetch = fetch,
    private verify: (
      idToken: string,
      clientId: string,
      nonce: string,
    ) => Promise<{ sub: string; email?: string }> = ChatgptAuth.verifyIdentity,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(key))
      throw Error("TOKEN_ENCRYPTION_KEY must be 32 bytes of hex");
    this.data = {
      hostId: `urn:uuid:${randomUUID()}`,
      active: null,
      accounts: [],
    };
    this.file = new EncryptedTokenFile(key, path, (value) =>
      stateSchema.parse(value),
    );
    try {
      this.data = this.file.read() ?? this.data;
    } catch {
      throw new Error(
        "Stored ChatGPT credentials cannot be decrypted. Restore TOKEN_ENCRYPTION_KEY.",
      );
    }
  }

  static async verifyIdentity(
    idToken: string,
    clientId: string,
    nonce: string,
  ) {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer,
      audience: clientId,
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 5,
    });
    if (payload.nonce !== nonce || !payload.sub)
      throw Error("ChatGPT identity validation failed");
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  }
  private save() {
    this.file.write(this.data);
  }
  get active() {
    return (
      this.data.accounts.find((a) => a.clientId === this.data.active) ?? null
    );
  }
  get status() {
    return {
      active: this.data.active,
      accounts: this.data.accounts.map((a) => ({
        clientId: a.clientId,
        email: a.email,
        connected: !!a.refreshToken,
        model: a.model,
      })),
    };
  }
  authorizationUrl(port: number, clientId?: string) {
    const account = clientId
      ? this.data.accounts.find((a) => a.clientId === clientId)
      : undefined;
    if (clientId && !account) throw Error("Unknown ChatGPT account");
    const redirect = `http://127.0.0.1:${port}/oauth/chatgpt/callback`;
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    this.generation++;
    this.refresh.invalidate();
    this.pending = {
      state,
      nonce,
      verifier,
      redirect,
      clientId: account?.clientId ?? "dynamic_agent_client",
      expiresAt: Date.now() + 600000,
    };
    this.save();
    const p = new URLSearchParams({
      client_id: this.pending.clientId,
      ext_agent_host_id: this.data.hostId,
      response_type: "code",
      redirect_uri: redirect,
      scope:
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    if (account?.email) p.set("login_hint", account.email);
    if (!account) p.set("agent_name_hint", "Mixed Chat Studio");
    return `${issuer}/api/accounts/authorize?${p}`;
  }
  async callback(q: {
    state?: string;
    code?: string;
    client_id?: string;
    error?: string;
  }) {
    const p = this.pending;
    const generation = this.generation;
    this.pending = null;
    if (!p || p.expiresAt < Date.now() || q.state !== p.state)
      throw Error("ChatGPT authorization state invalid or expired");
    if (q.error) throw Error("ChatGPT authorization was declined");
    if (!q.code) throw Error("ChatGPT authorization code missing");
    const clientId =
      p.clientId === "dynamic_agent_client" ? q.client_id : p.clientId;
    if (
      !clientId ||
      clientId === "dynamic_agent_client" ||
      (p.clientId !== "dynamic_agent_client" &&
        q.client_id &&
        q.client_id !== p.clientId)
    )
      throw Error("ChatGPT client registration mismatch");
    const r = await this.request(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: q.code,
        code_verifier: p.verifier,
        redirect_uri: p.redirect,
        resource,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("ChatGPT token exchange failed");
    const t = tokenSchema.parse(await r.json());
    if (!t.id_token) throw Error("ChatGPT identity token missing");
    const identity = await this.verify(t.id_token, clientId, p.nonce);
    const scopes = t.scope.split(/\s+/);
    if (
      !scopes.includes("chatgpt.tokens.use.direct") ||
      !scopes.includes("resource.invoke") ||
      !scopes.includes("offline_access")
    )
      throw Error("ChatGPT plan permission was not granted");
    if (generation !== this.generation)
      throw Error("ChatGPT authorization changed");
    const old = this.data.accounts.find((a) => a.clientId === clientId);
    if (old && old.subject !== identity.sub)
      throw Error("ChatGPT account identity mismatch");
    const next: Account = {
      clientId,
      subject: identity.sub,
      email: identity.email ?? null,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      idToken: t.id_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      earliestRefreshAt: refreshTime(t.earliest_refresh_at),
      scopes,
      model: old?.model ?? null,
    };
    this.generation++;
    this.refresh.invalidate();
    this.data.accounts = [
      ...this.data.accounts.filter((a) => a.clientId !== clientId),
      next,
    ];
    this.data.active = clientId;
    this.save();
  }
  select(clientId: string) {
    if (!this.data.accounts.some((a) => a.clientId === clientId))
      throw Error("Unknown ChatGPT account");
    this.generation++;
    this.refresh.invalidate();
    this.data.active = clientId;
    this.save();
  }
  setModel(slug: string, available: string[]) {
    const account = this.active;
    if (!account || !available.includes(slug))
      throw Error("Model unavailable for active ChatGPT account");
    this.generation++;
    this.refresh.invalidate();
    account.model = slug;
    this.save();
  }
  async access() {
    const a = this.active;
    if (!a?.refreshToken || !a.scopes.includes("chatgpt.tokens.use.direct"))
      throw Error("Connect ChatGPT first");
    if (a.expiresAt > Date.now() + 60000) return a.accessToken;
    const generation = this.generation;
    return this.refresh.run(async () => {
      if (a.earliestRefreshAt > Date.now())
        throw Error("ChatGPT refresh is not available yet");
      const r = await this.request(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: a.clientId,
          refresh_token: a.refreshToken,
          resource,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error("ChatGPT session expired; sign in again");
      const t = tokenSchema.parse(await r.json());
      if (!t.scope.split(/\s+/).includes("chatgpt.tokens.use.direct"))
        throw Error("ChatGPT plan permission expired");
      if (
        generation !== this.generation ||
        this.active !== a ||
        !a.refreshToken
      )
        throw Error("ChatGPT authorization changed");
      a.accessToken = t.access_token;
      a.refreshToken = t.refresh_token;
      a.expiresAt = Date.now() + t.expires_in * 1000;
      a.earliestRefreshAt = refreshTime(t.earliest_refresh_at);
      a.scopes = t.scope.split(/\s+/);
      this.save();
      return a.accessToken;
    });
  }
  async models() {
    const token = await this.access();
    const r = await this.request(`${resource}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("ChatGPT model list unavailable");
    const b = z
      .object({
        models: z.array(
          z.object({
            slug: z.string(),
            display_name: z.string(),
            visibility: z.string().optional(),
          }),
        ),
      })
      .parse(await r.json());
    return b.models
      .filter((m) => m.visibility === "list")
      .map((m) => ({ slug: m.slug, name: m.display_name }));
  }
  async disconnect() {
    const a = this.active;
    this.generation++;
    this.refresh.invalidate();
    this.pending = null;
    if (!a) return { revoked: true };
    const refreshToken = a.refreshToken;
    // Local deletion is immediate, independent of the remote revocation result.
    a.accessToken = "";
    a.refreshToken = "";
    a.idToken = null;
    a.expiresAt = 0;
    a.model = null;
    this.save();
    let revoked = false;
    if (refreshToken) {
      try {
        const discovery = await this.request(
          `${issuer}/.well-known/openid-configuration`,
          { signal: AbortSignal.timeout(10000) },
        );
        const doc = z
          .object({ revocation_endpoint: z.string().url() })
          .parse(await discovery.json());
        if (new URL(doc.revocation_endpoint).origin !== issuer)
          throw Error("Invalid revocation endpoint");
        const r = await this.request(doc.revocation_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: refreshToken,
            token_type_hint: "refresh_token",
            client_id: a.clientId,
          }),
          signal: AbortSignal.timeout(10000),
        });
        revoked = r.ok;
      } catch {
        /* local sign-out still clears secrets */
      }
    }
    return { revoked };
  }
}
