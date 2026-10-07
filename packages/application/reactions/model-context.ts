import type { ModelInput } from "./model-port.ts";
import {
  retainApprovedSummary,
  summarizeChat,
} from "../../domain/conversation/summary.ts";

/** Explicit outgoing fields prevent internal metadata from becoming model context. */
export function modelContext(input: ModelInput) {
  const message = (value: ModelInput["messages"][number]) => ({
    id: value.id,
    speaker: value.speaker,
    text: value.text,
  });
  const transcript = (
    value: NonNullable<ModelInput["transcripts"]>[number],
  ) => ({
    id: value.id,
    capturedAt: value.capturedAt,
    text: value.text,
  });
  return {
    description: input.description,
    reviewDraft: input.reviewDraft ?? null,
    ...(input.viewerState
      ? {
          viewerState: {
            revision: input.viewerState.revision,
            updatedAt: input.viewerState.updatedAt,
            values: input.viewerState.values,
          },
        }
      : {}),
    recentContext: input.messages.map(message),
    anonymousChatSummary: input.chatSummary
      ? retainApprovedSummary(input.chatSummary, summarizeChat([]))
      : null,
    newMessages: (input.newMessages ?? []).map(message),
    newTranscripts: (input.newTranscripts ?? []).map(transcript),
    recentTranscripts: (input.transcripts ?? []).map(transcript),
    frames: input.frames.map((frame) => ({
      id: frame.id,
      capturedAt: frame.capturedAt,
    })),
  };
}
