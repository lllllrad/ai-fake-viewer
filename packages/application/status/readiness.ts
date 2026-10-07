import type { BroadcastReadiness } from "../../contracts/readiness.ts";
export interface ReadinessFacts {
  demo: boolean;
  streamConfigured: boolean;
  modelReady: boolean;
  screenRecent: boolean;
  speechState: string;
}
export function projectReadiness(facts: ReadinessFacts): BroadcastReadiness {
  const checks = [
    {
      id: "stream",
      label: "AI 전용 스트림 주소",
      ready: facts.demo || facts.streamConfigured,
    },
    {
      id: "capture",
      label: "AI용 화면",
      ready: facts.demo || facts.screenRecent,
      optional: true,
    },
    {
      id: "audio",
      label: "마이크 음성",
      ready:
        facts.demo || ["receiving", "listening"].includes(facts.speechState),
      optional: true,
    },
    { id: "model", label: "AI 모델", ready: facts.demo || facts.modelReady },
  ];
  return {
    ready: checks.every((check) => check.ready || check.optional),
    checks,
  };
}
