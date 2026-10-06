import { StaleModelContextError } from "./errors.ts";
export interface AuthorizedAudience {
  participantId: string;
  epoch: number;
}
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
  privacyRevision?: number;
  frames: FrameEvidence[];
  transcripts?: SpeechEvidence[];
  newTranscripts?: SpeechEvidence[];
  messages: Array<{ id: string; text: string }>;
  newMessages?: Array<{ id: string; text: string }>;
}
export interface ModelAuthorizationSource {
  profileReady(): boolean;
  sessionOpen(): boolean;
  revision(): number | undefined;
  frame(id: string): FrameEvidence | undefined;
  transcripts(): readonly SpeechEvidence[];
  message(id: string): { text: string } | undefined;
  audience(messageIds: string[]): AuthorizedAudience[];
  recordRequest(participantId: string, requestId: string): void;
  followup(
    participantId: string,
    authorizedEpoch: number,
    requestId: string,
  ): void;
}
/** Rechecks the exact outgoing context at each provider boundary; retains only audience IDs. */
export class ModelAuthorization {
  private readonly audiences = new WeakMap<object, AuthorizedAudience[]>();
  constructor(private readonly source: ModelAuthorizationSource) {}
  readonly authorize = (input: AuthorizationInput) => {
    if (!this.source.profileReady())
      throw new Error(
        "현재 운영 프로필·동의 범위에서 외부 AI 처리가 허용되지 않습니다.",
      );
    if (
      !this.source.sessionOpen() ||
      input.privacyRevision !== this.source.revision()
    )
      throw new StaleModelContextError();
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
    this.audiences.set(
      input,
      this.source
        .audience([...new Set(messages.map((message) => message.id))])
        .map((audience) => ({
          participantId: audience.participantId,
          epoch: audience.epoch,
        })),
    );
  };
  readonly requestId = (id: string, input: AuthorizationInput) => {
    for (const audience of this.audiences.get(input) ?? []) {
      this.source.recordRequest(audience.participantId, id);
      this.source.followup(audience.participantId, audience.epoch, id);
    }
  };
}
