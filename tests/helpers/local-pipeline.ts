/** Unit fixtures only. Production composition never imports AI implementation modules. */
import { ReactionCoordinator } from "../../packages/application/reactions/coordinator.ts";
import {
  reactionPipelines,
  type ReactionPipeline,
} from "../../packages/application/reactions/pipelines.ts";
import { registerReactionProgram } from "../../packages/application/reactions/program.ts";
import { servicePipelines } from "../../services/viewer-ai/programs.ts";
const implementation = servicePipelines[0];
registerReactionProgram("standard", () => implementation);
export const standardPipeline: ReactionPipeline = {
  id: implementation.id,
  revision: implementation.revision,
  label: implementation.label,
  description: implementation.description,
  create: (...args) => new ReactionCoordinator(...args, implementation),
  draft: (options) => implementation.draft(options),
  inspect: (engine) =>
    implementation.inspect?.({
      members: engine.store.personaRuntime()?.members ?? [],
      state: engine.state,
      busy: engine.busy,
      diagnostics: engine.diagnostics,
      memories: engine.store.viewerMemory?.list() ?? [],
      pending: engine.pending,
    }) ?? [],
};
if (!reactionPipelines.list().length)
  reactionPipelines.register(standardPipeline);
