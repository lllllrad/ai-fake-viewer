import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";
import { dirname } from "node:path";

const root = "https://openapi.sooplive.com";
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export class SoopAuth {
  private generation = 0;
  token?: { accessToken: string; refreshToken: string; expiresAt: number };
  pending?: Promise<string>;

  constructor(
    private key: string,
    private path = "data/soop.tokens",
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
          "Stored SOOP credentials cannot be decrypted. Restore the encryption key or reauthorize.",
        );
      }
    }
  }

  authorizationUrl(clientId: string) {
    return `${root}/auth/code?${new URLSearchParams({
      client_id: clientId,
      scope: "broad_access_chatinfo",
    })}`;
  }

  async exchange(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    this.generation++;
    return this.issue(
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      clientId,
      clientSecret,
    );
  }

  private async issue(
    fields: Record<string, string>,
    clientId: string,
    clientSecret: string,
  ) {
    const generation = this.generation;
    const response = await this.request(`${root}/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
      },
      body: new URLSearchParams({
        ...fields,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`SOOP_TOKEN_HTTP_${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw Error("SOOP_TOKEN_INVALID_JSON");
    }
    const parsed = tokenSchema.safeParse(payload);
    if (!parsed.success) throw Error("SOOP_TOKEN_INVALID_RESPONSE");
    if (generation !== this.generation)
      throw Error("SOOP authorization changed");
    const next = {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: Date.now() + parsed.data.expires_in * 1000,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(this.key, "hex"),
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(next)),
      cipher.final(),
    ]);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(
      `${this.path}.tmp`,
      Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
      { mode: 0o600 },
    );
    renameSync(`${this.path}.tmp`, this.path);
    this.token = next;
    return next.accessToken;
  }

  async access(clientId: string, clientSecret: string) {
    if (!this.token) throw Error("auth_required");
    if (this.pending) return this.pending;
    if (this.token.expiresAt > Date.now() + 60000)
      return this.token.accessToken;
    this.pending = this.issue(
      { grant_type: "refresh_token", refresh_token: this.token.refreshToken },
      clientId,
      clientSecret,
    );
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  forget() {
    this.generation++;
    this.token = undefined;
    rmSync(this.path, { force: true });
  }
}
