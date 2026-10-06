import { soopSessionSchema } from "../../../../../packages/contracts/soop-bridge.ts";
import { z } from "zod";
import { adminClient } from "../../lib/admin-client.ts";
import type { SoopChat, SoopPorts } from "./controller.ts";
const noticeSchema = z.object({
  notice: z
    .object({ id: z.string(), text: z.string(), expiresAt: z.number() })
    .nullable(),
});
type SdkWindow = Window & {
  SOOP?: { ChatSDK: new (clientId: string) => SoopChat };
};
let loading: Promise<void> | undefined;
async function loadSdk() {
  if ((window as SdkWindow).SOOP?.ChatSDK) return;
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(
      () => finish(Error("SOOP 연결 도구 응답 시간이 초과되었습니다.")),
      10000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    script.src =
      "https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js";
    script.onload = () => finish();
    script.onerror = () =>
      finish(Error("SOOP 연결 도구를 불러오지 못했습니다."));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  await loading;
  if (!(window as SdkWindow).SOOP?.ChatSDK) {
    loading = undefined;
    throw Error("SOOP 연결 도구가 준비되지 않았습니다.");
  }
}
export function browserSoopPorts(refresh: () => Promise<void>): SoopPorts {
  const post = (path: string, body: unknown) =>
    adminClient.request(`soop/${path}`, { method: "POST", body });
  return {
    authorization: () =>
      adminClient.json("soop/chat-session", soopSessionSchema),
    createChat: async (clientId) => {
      await loadSdk();
      return new (window as SdkWindow).SOOP!.ChatSDK(clientId);
    },
    status: async (state, broadcastId) => {
      await post("status", { state, broadcastId });
      await refresh();
    },
    message: (message, broadcastId) =>
      post("message", { ...message, broadcastId }),
    nextNotice: (broadcastId) =>
      adminClient.json("soop/notices/next", noticeSchema, {
        method: "POST",
        body: { broadcastId },
      }),
    failNotice: (id, broadcastId) =>
      post("notices/failed", { id, broadcastId }),
  };
}
