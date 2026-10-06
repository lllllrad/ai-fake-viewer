import { AccountRefresh } from "../../application/accounts/refresh-flight.ts";
import { randomBytes, createHash } from "node:crypto";
import { EncryptedTokenFile } from "./encrypted-token-file.ts";
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
  private readonly file: EncryptedTokenFile<Token>;
  private token?: Token;
  private readonly refresh = new AccountRefresh<string>();
  private login?: {
    state: string;
    verifier: string;
    redirect: string;
    expires: number;
    generation: number;
  };
  private generation = 0;
  constructor(
    key: string,
    path = "data/youtube.tokens",
    private request: typeof fetch = fetch,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw Error("Invalid encryption key");
    this.file = new EncryptedTokenFile(key, path, (value) =>
      stored.parse(value),
    );
    try {
      this.token = this.file.read();
    } catch {
      throw new Error(
        "Stored YouTube credentials cannot be decrypted. Restore the key or reconnect.",
      );
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
    this.refresh.invalidate();
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
    this.file.write(next);
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
    this.refresh.invalidate();
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
    if (this.refresh.pending) return this.refresh.pending;
    const previous = this.token!,
      generation = this.generation;
    return this.refresh.run(async () => {
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
    });
  }
  forget() {
    this.generation++;
    this.refresh.invalidate();
    this.login = undefined;
    this.token = undefined;
    this.file.remove();
  }
}
