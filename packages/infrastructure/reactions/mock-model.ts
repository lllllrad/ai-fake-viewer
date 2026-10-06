import { setTimeout as sleep } from "node:timers/promises";
import type { Model } from "../../application/reactions/model-port.ts";
export const mockModel: Model = async (input, signal) => {
  await sleep(100, undefined, { signal });
  return {
    decision: {
      action: "say",
      text: "[DEMO] 도형이 움직이는 인공 화면이에요.",
      replyToMessageId: null,
      evidenceFrameIds: [input.frames.at(-1)!.id],
      evidenceMessageIds: [],
      evidenceTranscriptIds: [],
    },
    inputTokens: 0,
    outputTokens: 0,
  };
};
