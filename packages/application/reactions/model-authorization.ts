import { StaleModelContextError } from "./errors.ts";
interface SpeechEvidence {
  id: string;
  text: string;
  capturedAt: number;
}
interface FrameEvidence {
  id: string;
  capturedAt: number;
  bytes: Uint8Array;
}
export interface AuthorizationInput {
  frames: FrameEvidence[];
  transcripts?: SpeechEvidence[];
  newTranscripts?: SpeechEvidence[];
  messages: Array<{ id: string; text: string }>;
  newMessages?: Array<{ id: string; text: string }>;
}
export interface ModelAuthorizationSource {
  sessionOpen(): boolean;
  frame(id: string): FrameEvidence | undefined;
  transcripts(): readonly SpeechEvidence[];
  message(id: string): { text: string } | undefined;
}
/** Rechecks the exact outgoing context at each provider boundary; rejects stale evidence. */
export class ModelAuthorization {
  constructor(private readonly source: ModelAuthorizationSource) {}
  readonly authorize = (input: AuthorizationInput) => {
    if (!this.source.sessionOpen()) throw new StaleModelContextError();
    const speech = new Map(
      this.source.transcripts().map((chunk) => [chunk.id, chunk]),
    );
    for (const frame of input.frames) {
      const current = this.source.frame(frame.id);
      if (
        !current ||
        current.capturedAt !== frame.capturedAt ||
        current.bytes.length !== frame.bytes.length ||
        !current.bytes.every((byte, index) => byte === frame.bytes[index])
      )
        throw new StaleModelContextError();
    }
    for (const chunk of [
      ...(input.transcripts ?? []),
      ...(input.newTranscripts ?? []),
    ]) {
      const current = speech.get(chunk.id);
      if (
        !current ||
        current.text !== chunk.text ||
        current.capturedAt !== chunk.capturedAt
      )
        throw new StaleModelContextError();
    }
    const messages = [...input.messages, ...(input.newMessages ?? [])];
    for (const message of messages) {
      const current = this.source.message(message.id);
      if (!current || current.text !== message.text)
        throw new StaleModelContextError();
    }
  };
}
