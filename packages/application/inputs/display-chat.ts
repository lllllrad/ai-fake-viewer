import type {
  PlatformAccounts,
  AccountPlatform,
} from "../accounts/platform-accounts.ts";
import type { DisplayChatStatus } from "../../contracts/display-chat.ts";
import type { SoopSession } from "../../contracts/soop-bridge.ts";
export interface DisplayChatCommands {
  accounts: PlatformAccounts;
  status(): DisplayChatStatus;
  save(raw: unknown): Promise<void>;
  start(platform: AccountPlatform): void;
  stop(platform: AccountPlatform): Promise<void>;
  soopSession(): Promise<SoopSession>;
  soopStatus(state: string, epoch: string): void;
  soopMessage(input: {
    broadcastId: string;
    sourceId: string;
    userId: string;
    userNickname: string;
    message: string;
  }): void;
}
