export type Health = {
  label:
    "정상" | "준비 중" | "확인 필요" | "사용 안 함" | "중지됨" | "확인 불가";
  hint?: string;
};

export function inputHealth(
  state?: string,
  scope?: "chat_read" | "transcription",
): Health {
  const kind = state?.split(":", 1)[0];
  if (
    [
      "connected",
      "subscribed",
      "streaming",
      "polling",
      "receiving",
      "listening",
      "running",
      "demo",
      "demo_fixture",
    ].includes(kind ?? "")
  )
    return { label: "정상" };
  if (["connecting", "reconnecting", "fallback_to_rest"].includes(kind ?? ""))
    return {
      label: "준비 중",
      hint: "연결을 준비하고 있습니다. 잠시 기다려 주세요.",
    };
  if (kind === "privacy_blocked")
    return {
      label: "확인 필요",
      hint: "운영 프로필에 이 플랫폼·방송 계정의 수신 승인이 없습니다. config.yaml의 privacy.approvals를 확인하세요.",
    };
  if (kind === "disabled") return { label: "사용 안 함" };
  if (kind === "stopped")
    return { label: "중지됨", hint: "사용하려면 입력을 시작하세요." };
  if (!kind || kind === "unknown")
    return { label: "확인 불가", hint: "상태를 다시 확인하세요." };
  const hints: Record<string, string> = {
    auth_required: "계정을 다시 연결해 주세요.",
    config_required: "연결 설정을 확인해 주세요.",
    permission_blocked: "계정의 접근 권한을 확인해 주세요.",
    needs_approval: "사용 설정을 확인해 주세요.",
    awaiting_browser: "SOOP 채팅 연결을 눌러 수신을 시작해 주세요.",
    auth_ready:
      "계정 인증이 완료되었습니다. SOOP 채팅 연결을 눌러 수신을 시작해 주세요.",
    waiting_live:
      "연결한 채널에서 채팅이 열린 방송을 찾지 못했습니다. 30초마다 다시 확인합니다. 방송 중이라면 채널 또는 방송 URL 설정을 확인하세요.",
    broadcast_selection_required:
      "진행 중인 방송이 여러 개입니다. config.yaml의 youtube.video에 사용할 방송 URL을 지정하세요.",
    ended: "방송이 종료되었습니다.",
    budget_exhausted:
      scope === "transcription"
        ? "Groq 음성 인식의 앱 호출 횟수 한도에 도달했습니다."
        : "앱에 설정한 호출 횟수 한도에 도달했습니다.",
    quota_blocked:
      scope === "chat_read"
        ? "채팅 조회·수신 API 한도에 도달했습니다."
        : scope === "transcription"
          ? "Groq 음성 인식 API 한도에 도달했습니다."
          : "해당 API 사용 한도에 도달했습니다.",
  };
  return {
    label: "확인 필요",
    hint:
      hints[kind!] ?? "입력이 원활하지 않습니다. 연결 설정을 확인해 주세요.",
  };
}

export function chatHealth(states: Array<string | undefined>): Health {
  if (!states.length)
    return { label: "확인 불가", hint: "채팅 상태를 다시 확인하세요." };
  const active = states
    .map((state) => inputHealth(state))
    .filter((health) => health.label !== "사용 안 함");
  if (!active.length) return { label: "사용 안 함" };
  for (const label of [
    "확인 불가",
    "확인 필요",
    "중지됨",
    "준비 중",
  ] as const) {
    const problem = active.find((health) => health.label === label);
    if (problem)
      return {
        ...problem,
        label:
          label === "중지됨" &&
          active.some((health) => health.label !== "중지됨")
            ? "확인 필요"
            : label,
      };
  }
  return { label: "정상" };
}
