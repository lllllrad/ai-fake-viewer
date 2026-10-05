import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { z } from "zod";
import { dirname } from "node:path";
const root = "https://openapi.chzzk.naver.com";
const tokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal("Bearer").optional(),
  expiresIn: z.coerce.number().positive(),
  scope: z.string().optional(),
});
export const chzzkChatSchema = z.object({
  channelId: z.string(),
  senderChannelId: z.string(),
  profile: z.object({ nickname: z.string() }),
  content: z.string().min(1).max(4000),
  messageTime: z.number().int().nonnegative(),
});
export function normalizeChzzk(raw: unknown) {
  const e = chzzkChatSchema.parse(
    typeof raw === "string" ? JSON.parse(raw) : raw,
  );
  return {
    platform: "chzzk" as const,
    channel: e.channelId,
    author: e.senderChannelId,
    name: e.profile.nickname,
    text: e.content,
    publishedAt: e.messageTime,
  };
}
export class ChzzkAuth {
  private generation = 0;
  pending?: Promise<string>;
  states = new Map<string, number>();
  token?: { accessToken: string; refreshToken: string; expiresAt: number };
  constructor(
    private key: string,
    private path = "data/chzzk.tokens",
    private request: typeof fetch = fetch,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(key))
      throw Error("TOKEN_ENCRYPTION_KEY must be 32 bytes of hex");
    if (existsSync(path)) {
      try {
        const b = readFileSync(path);
        const d = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(key, "hex"),
          b.subarray(0, 12),
        );
        d.setAuthTag(b.subarray(12, 28));
        this.token = JSON.parse(
          Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
        );
      } catch {
        throw Error(
          "Stored CHZZK credentials cannot be decrypted. Restore the encryption key or reauthenticate.",
        );
      }
    }
  }
  authorizationUrl(redirect: string) {
    if (!process.env.CHZZK_CLIENT_ID || !process.env.CHZZK_CLIENT_SECRET)
      throw Error("CHZZK credentials missing");
    this.generation++;
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
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Buffer.from(this.key, "hex"), iv);
    const encrypted = Buffer.concat([
      c.update(JSON.stringify(next)),
      c.final(),
    ]);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(
      `${this.path}.tmp`,
      Buffer.concat([iv, c.getAuthTag(), encrypted]),
      { mode: 0o600 },
    );
    renameSync(`${this.path}.tmp`, this.path);
    this.token = next;
    return next.accessToken;
  }
  async access() {
    if (!this.token) throw Error("auth_required");
    if (this.pending) return this.pending;
    if (this.token.expiresAt > Date.now() + 60000)
      return this.token.accessToken;
    this.pending = this.issue({
      grantType: "refresh_token",
      refreshToken: this.token.refreshToken,
    });
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  async api(path: string, method = "GET") {
    const access = await this.access();
    const r = await this.request(root + path, {
      method,
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401) {
      if (this.token) this.token.expiresAt = 0;
      throw Error("auth_required");
    }
    if (!r.ok)
      throw Error(r.status === 403 ? "permission_blocked" : "reconnecting");
    if (r.status === 204) return {};
    const b: any = await r.json();
    if (b.code && b.code !== 200) throw Error("permission_blocked");
    return b.content ?? {};
  }
  forget() {
    this.generation++;
    this.token = undefined;
    this.states.clear();
    rmSync(this.path, { force: true });
  }
}
