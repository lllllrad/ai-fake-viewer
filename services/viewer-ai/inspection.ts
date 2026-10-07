import type { ViewerInspection } from "../../packages/contracts/reaction-inspection.ts";
import type { InspectionContext } from "../../packages/application/reactions/inspection-port.ts";
const decisionLabels: Record<string, string> = {
  say: "발화 선택",
  skip: "발화하지 않음",
  inspect: "추가 화면 관찰 요청",
};
export const standardInspection = (
  engine: InspectionContext,
): ViewerInspection[] =>
  engine.members.map((member): ViewerInspection => {
    const events = engine.diagnostics
      .filter((event) => event.details.memberId === member.id)
      .slice(-12);
    const latest = events.at(-1);
    const memory = engine.memories?.find(
      (state) => state.memberId === member.id,
    );
    const decision = events.findLast((event) => event.event === "model_result");
    const pending =
      engine.pending?.memberId === member.id ? engine.pending : undefined;
    return {
      memberId: member.id,
      status:
        engine.state !== "running"
          ? "중지됨"
          : pending
            ? "게시 대기"
            : engine.busy && latest?.event === "model_request"
              ? latest.details.stage === "review"
                ? "응답 검수 중"
                : "응답 생성 중"
              : "관찰 대기",
      updatedAt: latest?.at ?? member.lastPublishedAt,
      sections: [
        {
          label: "현재 AI 상태",
          value: memory ? memory.values : "아직 상태 업데이트가 없습니다.",
        },
        ...(memory
          ? [
              {
                label: "상태 업데이트",
                value: {
                  revision: memory.revision,
                  updatedAt: new Date(memory.updatedAt).toISOString(),
                  expiresAt: new Date(memory.expiresAt).toISOString(),
                },
              },
            ]
          : []),
        {
          label: "최근 모델 판단",
          value: decision
            ? (decisionLabels[String(decision.details.action)] ??
              String(decision.details.action))
            : "아직 기록된 모델 판단이 없습니다.",
        },

        {
          label: "참여 설정",
          value: {
            "주의 가중치": member.attention,
            "관심 범위": member.focusTags.join(", ") || "별도 설정 없음",
            "추측 참여": member.guessingEligible ? "허용" : "제한",
          },
        },
        {
          label: "최근 발화",
          value: {
            "최근 게시": member.lastPublishedAt
              ? new Date(member.lastPublishedAt).toISOString()
              : "아직 없음",
            "연속 발화 수": member.consecutiveMessages,
          },
        },
        { label: "최근 파이프라인 사건", value: events },
        ...(pending
          ? [{ label: "게시 대기 응답", value: pending.decision }]
          : []),
      ],
    };
  });
