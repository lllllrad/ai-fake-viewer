import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import { inputHealth } from "../../input-health.ts";

type Platform = "youtube" | "chzzk" | "soop";
export function platformPreparation(
  platform: Platform,
  setup: AdminStatus["setup"][Platform],
  state: string | undefined,
  stale: boolean,
  closed: boolean,
): { label: string; hint?: string } {
  if (stale) return { label: "확인 불가", hint: "상태를 다시 확인해 주세요." };
  const enabled = "mode" in setup ? setup.mode === "official" : setup.enabled;
  if (!enabled)
    return {
      label: "사용 안 함",
      hint: "사용할 플랫폼을 config.yaml에서 활성화해 주세요.",
    };
  // Only idle inputs use preparation facts. Preserve observed errors and live state.
  if (!["stopped", "disabled", "ended"].includes(state ?? ""))
    return inputHealth(state, "chat_read");
  if (
    "oauthConfigured" in setup &&
    setup.oauthConfigured &&
    !setup.credentialsConfigured
  )
    return {
      label: "계정 연결 필요",
      hint: "YouTube 방송 계정을 인증해 주세요.",
    };
  if (!setup.credentialsConfigured)
    return {
      label: "설정 필요",
      hint: "플랫폼 앱 인증 정보를 설정하고 서버를 재시작해 주세요.",
    };
  if (platform === "youtube" && "videoConfigured" in setup) {
    if (!setup.connected && !setup.videoConfigured && !setup.channelConfigured)
      return {
        label: "방송 대상 필요",
        hint: "YouTube 계정을 연결하거나 사용할 방송 URL·채널을 설정해 주세요.",
      };
  } else if ("tokenConfigured" in setup) {
    if (!setup.tokenConfigured)
      return {
        label: "계정 연결 필요",
        hint: "방송 계정을 인증하면 세션 시작 시 연결을 시도할 수 있습니다.",
      };
    if ("streamerConfigured" in setup && !setup.streamerConfigured)
      return {
        label: "방송 대상 필요",
        hint: "config.yaml에 SOOP 방송 계정을 설정해 주세요.",
      };
  }
  if (!setup.receiveApproved)
    return {
      label: "수신 승인 확인 필요",
      hint: "운영 프로필과 해당 플랫폼·방송 계정의 privacy.approvals를 확인해 주세요.",
    };
  return {
    label: "연결 준비됨",
    hint:
      (closed ? "새 방송 세션을 시작하면" : "채팅 수신을 시작하면") +
      " 연결을 시도합니다. 실제 권한·방송 활성 상태는 접속 후 확인됩니다." +
      (platform === "soop" ? " SOOP은 관리자 탭을 열어 두세요." : ""),
  };
}
