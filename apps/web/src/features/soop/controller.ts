import type { SoopSession } from "../../../../../packages/contracts/soop-bridge.ts";
export type SoopAuthorization = SoopSession;
export interface SoopMessage {
  userId: string;
  userNickname: string;
  message: string;
  sourceId: string;
}
export interface SoopChat {
  setAuth(token: string): void;
  handleReady(callback: () => void): void;
  handleMessageReceived(
    callback: (action: string, data: unknown) => void,
  ): void;
  handleChatClosed(callback: () => void): void;
  handleError(callback: () => void): void;
  connect(): Promise<unknown>;
  getRoomInfo(): Promise<{ bjId: string }>;
  disconnect(): void;
}
export interface SoopPorts {
  authorization(): Promise<SoopAuthorization>;
  createChat(clientId: string): Promise<SoopChat>;
  status(
    state: "subscribed" | "disconnected" | "failed",
    broadcastId: string,
  ): Promise<unknown>;
  message(message: SoopMessage, broadcastId: string): Promise<unknown>;
}
export interface SoopConnectionState {
  phase: "idle" | "connecting" | "connected" | "failed";
  message: string;
}

/** One connection generation owns its receive callbacks. */
class RoomMismatch extends Error {}
export class SoopController {
  private state: SoopConnectionState = { phase: "idle", message: "" };
  private listeners = new Set<() => void>();
  private revision = 0;
  private chat?: SoopChat;
  private broadcastId?: string;
  private tail: Promise<void> = Promise.resolve();
  private connectTimer?: ReturnType<typeof setTimeout>;
  private releaseReady?: () => void;
  private queuedMessages = 0;
  constructor(private readonly ports: SoopPorts) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: SoopConnectionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private detach() {
    clearTimeout(this.connectTimer);
    this.revision++;
    this.releaseReady?.();
    this.releaseReady = undefined;
    const chat = this.chat;
    this.chat = undefined;
    this.broadcastId = undefined;
    try {
      chat?.disconnect();
    } catch {
      /* Detached callbacks are already invalidated. */
    }
  }
  private current(revision: number) {
    return this.revision === revision;
  }
  private queue(
    revision: number,
    task: () => Promise<unknown>,
    failure: string,
  ) {
    this.tail = this.tail.then(async () => {
      if (!this.current(revision)) return;
      try {
        await task();
      } catch {
        if (this.current(revision))
          this.update({ ...this.state, message: failure });
      }
    });
    return this.tail;
  }
  connect = async () => {
    if (this.state.phase === "connecting") return;
    this.detach();
    const revision = this.revision;
    let broadcastId: string | undefined;
    this.update({
      phase: "connecting",
      message: "SOOP 채팅 연결을 준비하고 있습니다.",
    });
    this.connectTimer = setTimeout(() => {
      if (!this.current(revision) || this.state.phase !== "connecting") return;
      this.detach();
      this.update({
        phase: "failed",
        message: "SOOP 연결 시간이 초과되었습니다. 다시 연결해 주세요.",
      });
      if (broadcastId)
        void this.queue(
          this.revision,
          () => this.ports.status("failed", broadcastId!),
          "연결 상태를 서버에 전달하지 못했습니다.",
        );
    }, 30000);
    try {
      const auth = await this.ports.authorization();
      if (!this.current(revision)) return;
      broadcastId = auth.broadcastId;
      this.broadcastId = broadcastId;
      const chat = await this.ports.createChat(auth.clientId);
      if (!this.current(revision)) {
        chat.disconnect();
        return;
      }
      this.chat = chat;
      let resolveReady!: (ready: boolean) => void;
      const readiness = new Promise<boolean>((resolve) => {
        resolveReady = resolve;
      });
      this.releaseReady = () => resolveReady(false);
      let ready = false,
        roomVerified = false,
        announced = false;
      const active = () => this.current(revision) && this.chat === chat;
      const announce = () => {
        if (!active() || !ready || !roomVerified || announced) return;
        announced = true;
        clearTimeout(this.connectTimer);
        this.update({
          phase: "connected",
          message: "SOOP 채팅이 연결되었습니다. 관리자 탭을 열어 두세요.",
        });
        void this.queue(
          revision,
          () => this.ports.status("subscribed", auth.broadcastId),
          "연결 상태를 서버에 전달하지 못했습니다. 다시 연결해 주세요.",
        );
      };
      const terminate = (phase: "idle" | "failed", message: string) => {
        if (!active()) return;
        this.detach();
        this.update({ phase, message });
        void this.queue(
          this.revision,
          () =>
            this.ports.status(
              phase === "failed" ? "failed" : "disconnected",
              auth.broadcastId,
            ),
          "연결 종료 상태를 서버에 전달하지 못했습니다.",
        );
      };
      chat.setAuth(auth.accessToken);
      chat.handleReady(() => {
        if (!active()) return;
        ready = true;
        resolveReady(true);
        announce();
      });
      chat.handleMessageReceived((action, data) => {
        if (
          !active() ||
          !announced ||
          action !== "MESSAGE" ||
          !data ||
          typeof data !== "object"
        )
          return;
        const value = data as Record<string, unknown>;
        if (
          typeof value.userId !== "string" ||
          typeof value.userNickname !== "string" ||
          typeof value.message !== "string"
        )
          return;
        if (this.queuedMessages >= 128) {
          this.update({
            ...this.state,
            message: "채팅 전달이 지연되고 있습니다. 연결을 확인해 주세요.",
          });
          return;
        }
        const message = {
          sourceId: crypto.randomUUID(),
          userId: value.userId,
          userNickname: value.userNickname,
          message: value.message,
        };
        this.queuedMessages++;
        void this.queue(
          revision,
          () => this.ports.message(message, auth.broadcastId),
          "채팅을 서버에 전달하지 못했습니다. 연결 상태를 확인해 주세요.",
        ).finally(() => {
          this.queuedMessages--;
        });
      });
      chat.handleChatClosed(() =>
        terminate("idle", "SOOP 연결이 종료되었습니다. 다시 연결해 주세요."),
      );
      chat.handleError(() =>
        terminate("failed", "SOOP 방송 상태와 앱 권한을 확인해 주세요."),
      );
      await chat.connect();
      if (!active()) return;
      // The official SDK connect() resolves when opening the socket, before READY.
      // getRoomInfo() before READY emits connection-failed, even with valid auth.
      if (!(await readiness) || !active()) return;
      this.releaseReady = undefined;
      const room = await chat.getRoomInfo();
      if (!active()) return;
      if (room.bjId !== auth.streamerId)
        throw new RoomMismatch(
          "연결한 SOOP 방송 계정이 설정된 방송 계정과 다릅니다.",
        );
      roomVerified = true;
      announce();
    } catch (error) {
      if (!this.current(revision)) return;
      this.detach();
      this.update({
        phase: "failed",
        message:
          error instanceof RoomMismatch
            ? error.message
            : "SOOP에 연결하지 못했습니다. 계정·방송 상태를 확인해 주세요.",
      });
      if (broadcastId)
        await this.queue(
          this.revision,
          () => this.ports.status("failed", broadcastId!),
          "연결 실패 상태를 서버에 전달하지 못했습니다.",
        );
    }
  };
  disconnect = async () => {
    const broadcastId = this.broadcastId;
    this.detach();
    this.update({ phase: "idle", message: "SOOP 채팅 연결을 종료했습니다." });
    if (broadcastId)
      await this.queue(
        this.revision,
        () => this.ports.status("disconnected", broadcastId),
        "연결 종료 상태를 서버에 전달하지 못했습니다.",
      );
  };
  dispose = () => {
    this.detach();
    this.update({ phase: "idle", message: "" });
  };
  heartbeat = async () => {
    if (this.state.phase !== "connected" || !this.broadcastId) return;
    const revision = this.revision;
    try {
      await this.ports.status("subscribed", this.broadcastId);
    } catch {
      if (!this.current(revision)) return;
      this.detach();
      this.update({
        phase: "failed",
        message: "SOOP 연결 상태가 바뀌었습니다. 다시 연결해 주세요.",
      });
    }
  };
  drain = () => this.tail;
}
