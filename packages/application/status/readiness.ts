import type { BroadcastReadiness } from "../../contracts/readiness.ts";
export interface ReadinessFacts {
  demo: boolean;
  profileReady: boolean;
  modelReady: boolean;
  screenRecent: boolean;
  speechState: string;
  receiverConfigured: boolean;
  receiverStates: string[];
}
/** Optional collection failures remain visible without changing AI start eligibility. */
export function projectReadiness(facts: ReadinessFacts): BroadcastReadiness {
  if (facts.demo)
    return {
      ready: true,
      checks: [
        { id: "capture", label: "데모 영상 입력", ready: true },
        { id: "audio", label: "데모 음성 입력", ready: true },
        {
          id: "receiver",
          label: "데모 채팅 입력",
          ready: true,
          optional: true,
        },
        { id: "model", label: "데모 AI 모델", ready: true },
      ],
    };
  const checks = [
    {
      id: "privacy",
      label: "운영 프로필 및 동의 범위",
      ready: facts.profileReady,
    },
    {
      id: "capture",
      label: "송출 화면",
      ready: facts.screenRecent,
      optional: true,
    },
    {
      id: "audio",
      label: "음성 인식 입력",
      ready: ["receiving", "listening"].includes(facts.speechState),
      optional: true,
    },
    {
      id: "receiver",
      label: "선택 플랫폼 채팅 수신기",
      optional: true,
      ready:
        !facts.receiverConfigured ||
        facts.receiverStates.some((state) =>
          [
            "connecting",
            "connected",
            "streaming",
            "polling",
            "receiving",
          ].includes(state),
        ),
    },
    { id: "model", label: "AI 모델", ready: facts.modelReady },
  ];
  return {
    ready: checks.every((check) => check.ready || check.optional),
    checks,
  };
}
