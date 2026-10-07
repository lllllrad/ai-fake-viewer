export type SoopBrowserState =
  | "connecting"
  | "subscribed"
  | "disconnected"
  | "permission_blocked"
  | "failed";
export interface SoopBridgeSettings {
  enabled: boolean;
  available: boolean;
  closed: boolean;
  broadcastId: string;
  streamerId: string;
  clientId?: string;
  clientSecret?: string;
  state: string;
}
export interface SoopBridgePorts {
  settings(): SoopBridgeSettings;
  access(clientId: string, clientSecret: string): Promise<string>;
  status(state: SoopBrowserState | "auth_required"): void;
  connectionLost(): void;
  receive(message: {
    platform: "soop";
    channel: string;
    author: string;
    name: string;
    text: string;
    sourceId: null;
  }): void;
  notices: {
    reset(): void;
    next(
      connected: boolean,
    ): { id: string; text: string; expiresAt: number } | null;
    state(): string;
    failed(id: string): void;
    echo(author: string, text: string): void;
  };
}
export class SoopBridgeError extends Error {
  readonly statusCode = 409;
}
function available(settings: SoopBridgeSettings) {
  return (
    settings.enabled &&
    settings.available &&
    !settings.closed &&
    !!settings.streamerId
  );
}
/** Coordinates the official browser SDK bridge without owning SDK or HTTP objects. */
export class SoopBridge {
  constructor(private readonly ports: SoopBridgePorts) {}
  private assertAvailable() {
    const settings = this.ports.settings();
    if (!available(settings))
      throw new SoopBridgeError("SOOP chat input is unavailable.");
    return settings;
  }
  private assertBroadcast(broadcastId: string) {
    if (broadcastId !== this.ports.settings().broadcastId)
      throw new SoopBridgeError("SOOP broadcast changed. Connect again.");
  }
  async session() {
    const settings = this.assertAvailable();
    if (!settings.clientId || !settings.clientSecret)
      throw new SoopBridgeError(
        "SOOP developer app credentials are not configured.",
      );
    const current = () => {
      const next = this.ports.settings();
      return (
        available(next) &&
        next.broadcastId === settings.broadcastId &&
        next.streamerId === settings.streamerId &&
        next.clientId === settings.clientId &&
        next.clientSecret === settings.clientSecret
      );
    };
    let accessToken: string;
    try {
      accessToken = await this.ports.access(
        settings.clientId,
        settings.clientSecret,
      );
    } catch {
      if (current()) this.ports.status("auth_required");
      throw new SoopBridgeError("Authorize SOOP from the admin page first.");
    }
    if (!current())
      throw new SoopBridgeError(
        "SOOP broadcast or account configuration changed. Connect again.",
      );
    return {
      broadcastId: settings.broadcastId,
      clientId: settings.clientId,
      accessToken,
      streamerId: settings.streamerId,
    };
  }
  report(state: SoopBrowserState, broadcastId: string) {
    this.assertBroadcast(broadcastId);
    this.assertAvailable();
    if (state !== "subscribed") {
      this.ports.notices.reset();
      this.ports.connectionLost();
    }
    this.ports.status(state);
  }
  nextNotice(broadcastId: string) {
    this.assertBroadcast(broadcastId);
    const settings = this.ports.settings();
    const notice = this.ports.notices.next(
      available(settings) && settings.state === "subscribed",
    );
    return { notice, state: this.ports.notices.state() };
  }
  noticeFailed(id: string, broadcastId: string) {
    this.assertBroadcast(broadcastId);
    this.ports.notices.failed(id);
  }
  receive(
    message: { userId: string; userNickname: string; message: string },
    broadcastId: string,
  ) {
    this.assertBroadcast(broadcastId);
    const settings = this.assertAvailable();
    if (settings.state !== "subscribed")
      throw new SoopBridgeError(
        "SOOP chat is not connected to the configured broadcast.",
      );
    if (message.userId === settings.streamerId) {
      this.ports.notices.echo(message.userId, message.message);
    }
    this.ports.receive({
      platform: "soop",
      channel: settings.streamerId,
      author: message.userId,
      name: message.userNickname,
      text: message.message,
      sourceId: null,
    });
  }
}
