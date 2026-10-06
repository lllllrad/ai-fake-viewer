import { AccountRefresh } from "../../application/accounts/refresh-flight.ts";
import {
  platformTokenSchema,
  type PlatformToken,
} from "../../contracts/account-tokens.ts";
import { EncryptedTokenFile } from "./encrypted-token-file.ts";
import { z } from "zod";

const root = "https://openapi.sooplive.com";
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export class SoopAuth {
  private readonly file: EncryptedTokenFile<PlatformToken>;
  private generation = 0;
  token?: PlatformToken;
  private readonly refresh = new AccountRefresh<string>();
  get pending() {
    return this.refresh.pending;
  }

  constructor(
    key: string,
    path = "data/soop.tokens",
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
        "Stored SOOP credentials cannot be decrypted. Restore the encryption key or reauthorize.",
      );
    }
  }

  authorizationUrl(clientId: string) {
    this.generation++;
    this.refresh.invalidate();
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
    this.refresh.invalidate();
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
    if (fields.grant_type === "authorization_code") {
      this.generation++;
      this.refresh.invalidate();
    }
    this.file.write(next);
    this.token = next;
    return next.accessToken;
  }

  async access(clientId: string, clientSecret: string) {
    if (!this.token) throw Error("auth_required");
    if (this.pending) return this.pending;
    if (this.token.expiresAt > Date.now() + 60000)
      return this.token.accessToken;
    const refreshToken = this.token.refreshToken;
    return this.refresh.run(() =>
      this.issue(
        { grant_type: "refresh_token", refresh_token: refreshToken },
        clientId,
        clientSecret,
      ),
    );
  }

  forget() {
    this.generation++;
    this.refresh.invalidate();
    this.token = undefined;
    this.file.remove();
  }
}
