import { randomUUID, createHash } from "node:crypto";
import { ReactionCoordinator } from "../../application/reactions/coordinator.ts";
export { AiStartError } from "../../application/reactions/coordinator.ts";
import { TimingGate } from "../../application/reactions/timing-gate.ts";
import { TypeSafeTimingGate } from "./typesafe-gate.ts";
import { generationIssue, ModelRequestError } from "../../model-errors.ts";
import type { Store } from "../../storage.ts";
import type { Capture } from "../inputs/screen-input.ts";
import type { Config } from "../../config.ts";
import type { Model } from "../../application/reactions/model-port.ts";
import type { Transcriber } from "../inputs/speech-input.ts";

/** Node composition only; the application coordinator owns generation and publication flow. */
export class Scheduler extends ReactionCoordinator<Buffer, NodeJS.Timeout> {
  declare store: Store;
  declare capture: Capture;
  declare config: Config;
  declare transcriber: Transcriber | undefined;
  constructor(
    store: Store,
    capture: Capture,
    config: Config,
    model: Model<Buffer>,
    demo = false,
    providerReady: () => boolean = () =>
      !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL,
    transcriber?: Transcriber,
    gate = new TimingGate(config.ai.gate, new TypeSafeTimingGate()),
    random: () => number = () => Math.random(),
  ) {
    super(
      store,
      capture,
      config,
      model,
      demo,
      providerReady,
      transcriber,
      gate,
      random,
      {
        now: () => Date.now(),
        id: randomUUID,
        hash: (value) => createHash("sha256").update(value).digest("hex"),
        clock: {
          repeat: (callback, ms) => setInterval(callback, ms),
          cancelRepeat: (handle) => clearInterval(handle),
          delay: (callback, ms) => setTimeout(callback, ms),
          cancelDelay: (handle) => clearTimeout(handle),
        },
        issue: (error) => ({
          issue: generationIssue(error),
          details: error instanceof ModelRequestError ? error.details : {},
        }),
      },
    );
  }
}
