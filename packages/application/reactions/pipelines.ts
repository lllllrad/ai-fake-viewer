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
export const standardPipeline: ReactionPipeline = {
  id: "standard",
  revision: 1,
  label: "기본 시청자",
  description: "관찰·참여 선택 → 생성·검수 → 발행",
  create: (...args) => new ReactionCoordinator(...args),
  draft: generateReviewedDraft,
};
/** Register trusted implementations here. Configuration selects IDs, never executable paths. */
export const reactionPipelines = new ReactionPipelineRegistry([
  standardPipeline,
]);
