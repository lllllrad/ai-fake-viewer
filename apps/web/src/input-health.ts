export type Health = {
  label:
    "정상" | "준비 중" | "확인 필요" | "사용 안 함" | "중지됨" | "확인 불가";
  hint?: string;
};

export function inputHealth(state?: string, scope?: "transcription"): Health {
  const kind = state?.split(":", 1)[0];
  if (
    [
      "connected",
      "receiving",
      "listening",
      "running",
      "demo",
      "demo_fixture",
    ].includes(kind ?? "")
  )
    return { label: "정상" };
  if (["connecting", "reconnecting"].includes(kind ?? ""))
    return {
      label: "준비 중",
      hint: "연결을 준비하고 있습니다. 잠시 기다려 주세요.",
    };
  if (kind === "session_closed")
    return {
      label: "확인 필요",
      hint: "방송이 종료되었습니다. 새 방송을 시작하세요.",
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
    ended: "방송이 종료되었습니다.",
    budget_exhausted:
      scope === "transcription"
        ? "음성 인식의 앱 호출 횟수 한도에 도달했습니다."
        : "앱에 설정한 호출 횟수 한도에 도달했습니다.",
    quota_blocked:
      scope === "transcription"
        ? "음성 인식 API 한도에 도달했습니다."
        : "해당 API 사용 한도에 도달했습니다.",
  };
  return {
    label: "확인 필요",
    hint:
      hints[kind!] ?? "입력이 원활하지 않습니다. 연결 설정을 확인해 주세요.",
  };
}
