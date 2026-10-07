export type AccountPlatform = "youtube" | "chzzk" | "soop";
export class AccountActionError extends Error {
  readonly statusCode = 409;
}
export interface PlatformAccountPorts {
  settings(): {
    demo: boolean;
    youtube: { enabled: boolean; configured: boolean; redirectUri: string };
    chzzk: { enabled: boolean; configured: boolean; redirectUri: string };
    soop: {
      enabled: boolean;
      clientId?: string;
      clientSecret?: string;
      redirectUri: string;
    };
  };
  youtube: {
    authorizationUrl(redirect: string): string;
    callback(
      code: string | undefined,
      state: string,
      denied: boolean,
    ): Promise<void>;
    forget(): void;
  };
  chzzk: {
    authorizationUrl(redirect: string): string;
    cancel(state: string): void;
    exchange(code: string, state: string): Promise<void>;
    forget(): void;
  };
  soop: {
    authorizationUrl(clientId: string): string;
    exchange(
      code: string,
      clientId: string,
      clientSecret: string,
      redirect: string,
    ): Promise<unknown>;
    forget(): void;
  };
  stop(platform: AccountPlatform): Promise<void>;
  soopStatus(state: "auth_required" | "auth_ready" | "auth_failed"): void;
  now(): number;
}
/** Account workflow policy; OAuth wire protocols and credentials stay in adapters. */
export class PlatformAccounts {
  private readonly disconnecting = new Set<AccountPlatform>();
  private soopPendingUntil?: number;
  private soopRevision = 0;
  constructor(private readonly ports: PlatformAccountPorts) {}
  private assertAvailable(platform: AccountPlatform) {
    if (this.disconnecting.has(platform))
      throw new AccountActionError(
        "계정 연결 해제가 진행 중입니다. 완료 후 다시 시도해 주세요.",
      );
  }
  authorize(platform: AccountPlatform) {
    this.assertAvailable(platform);
    const settings = this.ports.settings();
    if (platform === "youtube") {
      if (
        settings.demo ||
        !settings.youtube.enabled ||
        !settings.youtube.configured
      )
        throw new AccountActionError(
          "config.yaml의 displayChat.youtube.enabled와 .env의 YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET을 설정해 주세요.",
        );
      return this.ports.youtube.authorizationUrl(settings.youtube.redirectUri);
    }
    if (platform === "chzzk") {
      if (settings.demo)
        throw new AccountActionError(
          "Demo mode uses artificial inputs. Restart with npm start for live CHZZK.",
        );
      if (!settings.chzzk.enabled)
        throw new AccountActionError(
          "Set displayChat.chzzk.enabled: true in config.yaml, then restart.",
        );
      if (!settings.chzzk.configured)
        throw new AccountActionError(
          "Set CHZZK_CLIENT_ID and CHZZK_CLIENT_SECRET in .env, then restart.",
        );
      return this.ports.chzzk.authorizationUrl(settings.chzzk.redirectUri);
    }
    if (settings.demo)
      throw new AccountActionError(
        "SOOP authorization is unavailable in demo mode.",
      );
    if (!settings.soop.enabled)
      throw new AccountActionError(
        "Set displayChat.soop.enabled: true in config.yaml, then restart.",
      );
    if (!settings.soop.clientId || !settings.soop.clientSecret)
      throw new AccountActionError(
        "Set SOOP_CLIENT_ID and SOOP_CLIENT_SECRET in .env, then restart.",
      );
    const url = this.ports.soop.authorizationUrl(settings.soop.clientId);
    this.soopRevision++;
    this.soopPendingUntil = this.ports.now() + 300000;
    return url;
  }
  async disconnect(platform: AccountPlatform) {
    this.assertAvailable(platform);
    this.disconnecting.add(platform);
    if (platform === "soop") {
      this.soopRevision++;
      this.soopPendingUntil = undefined;
    }
    try {
      await this.ports.stop(platform);
      this.ports[platform].forget();
      if (platform === "soop") this.ports.soopStatus("auth_required");
    } finally {
      this.disconnecting.delete(platform);
    }
  }
  async completeYoutube(query: {
    code?: string;
    state: string;
    error?: string;
  }) {
    this.assertAvailable("youtube");
    const settings = this.ports.settings();
    if (settings.demo || !settings.youtube.enabled) throw new Error("disabled");
    await this.ports.youtube.callback(query.code, query.state, !!query.error);
    await this.ports.stop("youtube");
  }
  async completeChzzk(query: {
    code?: string;
    state?: string;
    error?: string;
  }) {
    this.assertAvailable("chzzk");
    if (query.error || (!query.code && query.state)) {
      if (query.state) this.ports.chzzk.cancel(query.state);
      throw new Error("CHZZK_USER_DENIED");
    }
    if (!query.code || !query.state) {
      if (query.state) this.ports.chzzk.cancel(query.state);
      throw new Error("CHZZK_CALLBACK_MISSING_FIELDS");
    }
    await this.ports.chzzk.exchange(query.code, query.state);
  }
  async completeSoop(query: { code?: string; error?: string }) {
    this.assertAvailable("soop");
    const pending = this.soopPendingUntil;
    this.soopPendingUntil = undefined;
    if (
      query.error ||
      !query.code ||
      pending === undefined ||
      pending <= this.ports.now()
    ) {
      this.ports.soopStatus("auth_required");
      throw new Error("SOOP_AUTHORIZATION_EXPIRED");
    }
    const revision = this.soopRevision;
    try {
      const { soop, demo } = this.ports.settings();
      if (demo || !soop.enabled || !soop.clientId || !soop.clientSecret)
        throw new Error("SOOP credentials are not configured");
      await this.ports.soop.exchange(
        query.code,
        soop.clientId,
        soop.clientSecret,
        soop.redirectUri,
      );
      if (revision !== this.soopRevision)
        throw new Error("SOOP authorization changed");
      this.ports.soopStatus("auth_ready");
    } catch (error) {
      if (revision === this.soopRevision) this.ports.soopStatus("auth_failed");
      throw error;
    }
  }
}
