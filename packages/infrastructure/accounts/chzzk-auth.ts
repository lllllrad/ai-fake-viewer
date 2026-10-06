import { AccountRefresh } from "../../application/accounts/refresh-flight.ts";
import {
  platformTokenSchema,
  type PlatformToken,
} from "../../contracts/account-tokens.ts";
import { randomBytes } from "node:crypto";
import { EncryptedTokenFile } from "./encrypted-token-file.ts";
import { z } from "zod";
import { ApiQuotaError } from "../../api-health.ts";
const root = "https://openapi.chzzk.naver.com";
const tokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal("Bearer").optional(),
  expiresIn: z.coerce.number().positive(),
  scope: z.string().optional(),
});
export class ChzzkAuth {
  private readonly file: EncryptedTokenFile<PlatformToken>;
  private generation = 0;
  private readonly refresh = new AccountRefresh<string>();
  get pending() {
    return this.refresh.pending;
  }
  states = new Map<string, number>();
  token?: PlatformToken;
  constructor(
    key: string,
    path = "data/chzzk.tokens",
    private request: typeof fetch = fetch,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(key))
      throw Error("TOKEN_ENCRYPTION_KEY must be 32 bytes of hex");
    this.file = new EncryptedTokenFile(key, path, (value) =>
      platformTokenSchema.parse(value),
    );
    try {
      this.token = this.file.read();
    } catch {
      throw new Error(
        "Stored CHZZK credentials cannot be decrypted. Restore the encryption key or reauthenticate.",
      );
    }
  }
  authorizationUrl(redirect: string) {
    if (!process.env.CHZZK_CLIENT_ID || !process.env.CHZZK_CLIENT_SECRET)
      throw Error("CHZZK credentials missing");
    this.generation++;
    this.refresh.invalidate();
    this.states.clear();
    const state = randomBytes(32).toString("hex");
    this.states.set(state, Date.now() + 300000);
    return `https://chzzk.naver.com/account-interlock?${new URLSearchParams({ clientId: process.env.CHZZK_CLIENT_ID, redirectUri: redirect, state })}`;
  }
  async exchange(code: string, state: string) {
    const expiry = this.states.get(state);
    this.states.delete(state);
    if (!expiry || expiry < Date.now()) throw new Error("CHZZK_STATE_INVALID");
    this.generation++;
    this.refresh.invalidate();
    await this.issue({ grantType: "authorization_code", code, state });
  }
  async issue(fields: Record<string, string>) {
    const generation = this.generation;
    const r = await this.request(`${root}/auth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...fields,
        clientId: process.env.CHZZK_CLIENT_ID,
        clientSecret: process.env.CHZZK_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      // Do not include response bodies: providers may echo codes or credentials.
      throw new Error(`CHZZK_TOKEN_HTTP_${r.status}`);
    }
    let payload: unknown;
    try {
      payload = await r.json();
    } catch {
      throw new Error("CHZZK_TOKEN_INVALID_JSON");
    }
    const envelope =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : undefined;
    const tokenPayload =
      envelope && envelope.content && typeof envelope.content === "object"
        ? envelope.content
        : payload;
    if (!tokenPayload || typeof tokenPayload !== "object")
      throw new Error("CHZZK_TOKEN_INVALID_RESPONSE");
    const parsed = tokenSchema.safeParse(tokenPayload);
    if (!parsed.success) throw new Error("CHZZK_TOKEN_INVALID_RESPONSE");
    if (envelope && typeof envelope.code === "number" && envelope.code !== 200)
      throw new Error(`CHZZK_TOKEN_API_CODE_${envelope.code}`);
    if (generation !== this.generation)
      throw Error("CHZZK authorization changed");
    const t = parsed.data;
    const next = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: Date.now() + t.expiresIn * 1000,
    };
    if (fields.grantType === "authorization_code") {
      this.generation++;
      this.refresh.invalidate();
    }
    this.file.write(next);
    this.token = next;
    return next.accessToken;
  }
  async access() {
    if (!this.token) throw Error("auth_required");
    if (this.pending) return this.pending;
    if (this.token.expiresAt > Date.now() + 60000)
      return this.token.accessToken;
    const refreshToken = this.token.refreshToken;
    return this.refresh.run(() =>
      this.issue({ grantType: "refresh_token", refreshToken }),
    );
  }
  async api(path: string, method = "GET") {
    const generation = this.generation;
    const access = await this.access();
    const token = this.token;
    const assertCurrent = () => {
      if (generation !== this.generation || token !== this.token)
        throw Error("CHZZK authorization changed");
    };
    assertCurrent();
    const r = await this.request(root + path, {
      method,
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(15000),
    });
    assertCurrent();
    if (r.status === 401) {
      if (this.token) this.token.expiresAt = 0;
      throw Error("auth_required");
    }
    if (r.status === 429)
      throw new ApiQuotaError(`CHZZK Session API ${path.split("?")[0]}`);
    if (!r.ok)
      throw Error(r.status === 403 ? "permission_blocked" : "reconnecting");
    if (r.status === 204) return {};
    const raw: unknown = await r.json();
    assertCurrent();
    const body = z
      .object({ code: z.number().optional(), content: z.unknown().optional() })
      .safeParse(raw);
    if (!body.success || (body.data.code && body.data.code !== 200))
      throw Error("permission_blocked");
    return body.data.content ?? {};
  }
  forget() {
    this.generation++;
    this.refresh.invalidate();
    this.token = undefined;
    this.states.clear();
    this.file.remove();
  }
}
