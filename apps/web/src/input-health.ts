export type Health = {
  label:
    "정상" | "준비 중" | "확인 필요" | "사용 안 함" | "중지됨" | "확인 불가";
  hint?: string;
};

export function inputHealth(state?: string): Health {
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
    awaiting_browser: "상세 설정에서 채팅 연결을 시작해 주세요.",
    waiting_live: "방송이 시작되었는지 확인해 주세요.",
    ended: "방송이 종료되었습니다.",
    budget_exhausted: "사용 한도에 도달했습니다. 한도를 확인해 주세요.",
    quota_blocked: "사용 한도에 도달했습니다. 한도를 확인해 주세요.",
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
    .map(inputHealth)
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
