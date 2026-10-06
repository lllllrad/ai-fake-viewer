import type {
  ModelInput as GenerationInput,
  Model as GenerationModel,
} from "./application/reactions/model-port.ts";
export type ModelInput = GenerationInput<Buffer>;
export type Model = GenerationModel<Buffer>;
export type { ModelResult } from "./application/reactions/model-port.ts";
export { modelMessages } from "./infrastructure/reactions/model-messages.ts";
export { limitModelConcurrency } from "./application/reactions/model-concurrency.ts";
export { validateDecision } from "./application/reactions/validate-decision.ts";
export { mockModel } from "./infrastructure/reactions/mock-model.ts";
export { openaiModel } from "./infrastructure/reactions/responses-api.ts";
export { chatgptModel } from "./infrastructure/reactions/chatgpt-model.ts";
