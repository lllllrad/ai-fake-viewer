import type { ViewerInspection } from "../../contracts/reaction-inspection.ts";
import { ReactionCoordinator } from "./coordinator.ts";
import { generateReviewedDraft } from "./draft-review.ts";
/** Public lifecycle contract; implementations need not inherit the standard coordinator. */
export type ReactionEngine<
  Bytes extends Uint8Array = Uint8Array,
  Handle = unknown,
> = Pick<
  ReactionCoordinator<Bytes, Handle>,
  keyof ReactionCoordinator<Bytes, Handle>
>;
export type PipelineArguments<
  Bytes extends Uint8Array,
  Handle,
> = ConstructorParameters<typeof ReactionCoordinator<Bytes, Handle>>;
export interface ReactionPipeline {
  id: string;
  revision: number;
  label: string;
  description: string;
  create<Bytes extends Uint8Array, Handle>(
    ...args: PipelineArguments<Bytes, Handle>
  ): ReactionEngine<Bytes, Handle>;
  /** Optional, synchronous, read-only inspection. Must not make model calls. */
  inspect?<Bytes extends Uint8Array, Handle>(
    engine: ReactionEngine<Bytes, Handle>,
  ): ViewerInspection[];
  /** Isolated draft experiments must use the same implementation's draft path. */
  draft: typeof generateReviewedDraft;
}
export class ReactionPipelineRegistry {
  private readonly entries = new Map<string, ReactionPipeline>();
  constructor(pipelines: readonly ReactionPipeline[] = []) {
    for (const pipeline of pipelines) this.register(pipeline);
  }
  register(pipeline: ReactionPipeline) {
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(pipeline.id) ||
      !Number.isSafeInteger(pipeline.revision) ||
      pipeline.revision < 1 ||
      !pipeline.label.trim() ||
      this.entries.has(pipeline.id)
    )
      throw Error("Invalid or duplicate AI pipeline type");
    this.entries.set(pipeline.id, Object.freeze({ ...pipeline }));
  }
  get(id: string): ReactionPipeline {
    const pipeline = this.entries.get(id);
    if (!pipeline) throw Error(`Unknown AI pipeline type: ${id}`);
    return pipeline;
  }
  list() {
    return [...this.entries.values()].map(
      ({ id, revision, label, description }) => ({
        id,
        revision,
        label,
        description,
      }),
    );
  }
  create<Bytes extends Uint8Array, Handle>(
    id: string,
    ...args: PipelineArguments<Bytes, Handle>
  ) {
    return this.get(id).create(...args);
  }
}
const decisionLabels: Record<string, string> = {
  say: "발화 선택",
  skip: "발화하지 않음",
  inspect: "추가 화면 관찰 요청",
};
export const standardPipeline: ReactionPipeline = {
  id: "standard",
  revision: 1,
  label: "기본 시청자",
  description: "관찰·참여 선택 → 생성·검수 → 발행",
  create: (...args) => new ReactionCoordinator(...args),
  draft: generateReviewedDraft,
  inspect: (engine) =>
    (engine.store.personaRuntime()?.members ?? []).map(
      (member): ViewerInspection => {
        const events = engine.diagnostics
          .filter((event) => event.details.memberId === member.id)
          .slice(-12);
        const latest = events.at(-1);
        const decision = events.findLast(
          (event) => event.event === "model_result",
        );
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
      },
    ),
};
/** Register trusted implementations here. Configuration selects IDs, never executable paths. */
export const reactionPipelines = new ReactionPipelineRegistry([
  standardPipeline,
]);
