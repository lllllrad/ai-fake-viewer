import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
export const youtubeScope = "https://www.googleapis.com/auth/youtube.force-ssl";
const stored = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  channelId: z.string().min(1),
  clientId: z.string().min(1),
});
type Token = z.infer<typeof stored>;
export class YoutubeAuth {
  private token?: Token;
  private pending?: Promise<string>;
  private login?: {
    state: string;
    verifier: string;
    redirect: string;
    expires: number;
    generation: number;
  };
  private generation = 0;
  constructor(
    private key: string,
    private path = "data/youtube.tokens",
    private request: typeof fetch = fetch,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw Error("Invalid encryption key");
    if (existsSync(path)) {
      try {
        const b = readFileSync(path),
          d = createDecipheriv(
            "aes-256-gcm",
            Buffer.from(key, "hex"),
            b.subarray(0, 12),
          );
        d.setAuthTag(b.subarray(12, 28));
        this.token = stored.parse(
          JSON.parse(
            Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
          ),
        );
      } catch {
        throw Error(
          "Stored YouTube credentials cannot be decrypted. Restore the key or reconnect.",
        );
      }
    }
  }
  get connected() {
    return (
      !!this.token && this.token.clientId === process.env.YOUTUBE_CLIENT_ID
    );
  }
  get channelId() {
    return this.connected ? this.token!.channelId : undefined;
  }
  get configured() {
    return (
      !!process.env.YOUTUBE_CLIENT_ID && !!process.env.YOUTUBE_CLIENT_SECRET
    );
  }
  authorizationUrl(redirect: string) {
    if (!this.configured) throw Error("YouTube OAuth credentials missing");
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(32).toString("base64url");
    this.login = {
      state,
      verifier,
      redirect,
      expires: Date.now() + 300000,
      generation: ++this.generation,
    };
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID!, redirect_uri: redirect, response_type: "code", scope: youtubeScope, access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })}`;
  }
  private async issue(fields: Record<string, string>) {
    const r = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...fields,
        client_id: process.env.YOUTUBE_CLIENT_ID ?? "",
        client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw Error("YouTube authorization failed; reconnect the account");
    const data = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
        token_type: z.literal("Bearer"),
      })
      .safeParse(await r.json());
    if (!data.success) throw Error("Invalid YouTube token response");
    return data.data;
  }
  private save(next: Token) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", Buffer.from(this.key, "hex"), iv);
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
  }
  async callback(code: string | undefined, state: string, denied = false) {
    const login = this.login;
    if (!login || state !== login.state)
      throw Error("YouTube OAuth state invalid");
    this.login = undefined;
    if (login.expires <= Date.now() || denied || !code)
      throw Error("YouTube authorization expired or canceled");
    const clientId = process.env.YOUTUBE_CLIENT_ID!;
    const t = await this.issue({
      grant_type: "authorization_code",
      code,
      redirect_uri: login.redirect,
      code_verifier: login.verifier,
    });
    if (!t.refresh_token || !t.scope?.split(" ").includes(youtubeScope))
      throw Error(
        "YouTube sending permission/offline access missing; reconnect",
      );
    const r = await this.request(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      {
        headers: { authorization: `Bearer ${t.access_token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) throw Error("YouTube channel lookup failed");
    const b = (await r.json()) as any;
    const channelId = b.items?.length === 1 ? b.items[0].id : undefined;
    if (typeof channelId !== "string" || !channelId)
      throw Error("Select one YouTube channel");
    if (
      login.generation !== this.generation ||
      clientId !== process.env.YOUTUBE_CLIENT_ID
    )
      throw Error("YouTube authorization changed");
    this.save({
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      channelId,
      clientId,
    });
  }
  async access() {
    if (!this.connected) throw Error("YouTube login required");
    if (this.token!.expiresAt > Date.now() + 60000)
      return this.token!.accessToken;
    if (this.pending) return this.pending;
    const previous = this.token!,
      generation = this.generation;
    this.pending = (async () => {
      const t = await this.issue({
        grant_type: "refresh_token",
        refresh_token: previous.refreshToken,
      });
      if (
        generation !== this.generation ||
        previous !== this.token ||
        !this.connected
      )
        throw Error("YouTube account changed");
      if (t.scope && !t.scope.split(" ").includes(youtubeScope))
        throw Error("YouTube sending permission missing");
      this.save({
        ...previous,
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? previous.refreshToken,
        expiresAt: Date.now() + t.expires_in * 1000,
      });
      return t.access_token;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  forget() {
    this.generation++;
    this.login = undefined;
    this.token = undefined;
    rmSync(this.path, { force: true });
  }
}
