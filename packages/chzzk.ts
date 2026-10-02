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
const root = "https://openapi.chzzk.naver.com";
const tokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.coerce.number().positive(),
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
    this.states.clear();
    const state = randomBytes(32).toString("hex");
    this.states.set(state, Date.now() + 300000);
    return `https://chzzk.naver.com/account-interlock?${new URLSearchParams({ clientId: process.env.CHZZK_CLIENT_ID, redirectUri: redirect, state })}`;
  }
  async exchange(code: string, state: string) {
    const expiry = this.states.get(state);
    this.states.delete(state);
    if (!expiry || expiry < Date.now())
      throw Error("OAuth state expired or invalid");
    await this.issue({ grantType: "authorization_code", code, state });
  }
  async issue(fields: Record<string, string>) {
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
    if (!r.ok) throw Error("auth_required");
    const t = tokenSchema.parse(await r.json());
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
    mkdirSync("data", { recursive: true, mode: 0o700 });
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
    if (this.pending) return this.pending;
    if (!this.token) throw Error("auth_required");
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
    this.token = undefined;
    this.states.clear();
    rmSync(this.path, { force: true });
  }
}
