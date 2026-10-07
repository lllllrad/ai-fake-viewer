import { standardInspection } from "./inspection.ts";
import type { InspectionContext } from "../../packages/application/reactions/inspection-port.ts";
import type { ViewerInspection } from "../../packages/contracts/reaction-inspection.ts";
import { chooseCastMember } from "./cast-selection.ts";
import { generateToolDraft } from "./tool-draft.ts";
import type { ReactionProgram } from "../../packages/application/reactions/program.ts";
export interface ServicePipeline extends ReactionProgram {
  inspect(context: InspectionContext): ViewerInspection[];
  id: string;
  revision: number;
  label: string;
  description: string;
}
/** AI implementations are registered only in this independently running service. */
export const servicePipelines: ServicePipeline[] = [
  {
    id: "standard",
    revision: 1,
    initialState: {
      mood: "차분함",
      focus: "방송에서 들어오는 새 정보",
      intent: "관찰하며 참여할 순간 기다리기",
      summary: "아직 관찰한 대화가 없음",
    },
    label: "기본 시청자",
    description: "관찰·참여 선택 → 생성·검수 → 발행 요청",
    async select(input, signal) {
      signal.throwIfAborted();
      let index = 0;
      return chooseCastMember({
        ...input,
        random: () => input.randomValues[index++] ?? 0.5,
      });
    },
    draft: generateToolDraft,
    inspect: standardInspection,
  },
];
