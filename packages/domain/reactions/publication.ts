import type { ReactionDecision } from "./decision.ts";
export interface PublicationInput {
  messages: Array<{ id: string; text: string }>;
  frames: Array<{ id: string }>;
  privacyRevision?: number;
}
export interface CurrentEvidence {
  messages: ReadonlyMap<string, string>;
  frames: ReadonlySet<string>;
  transcripts: ReadonlySet<string>;
  recentVideo: boolean;
  privacyRevision?: number;
}
export function evidenceProblem(
  input: PublicationInput,
  decision: ReactionDecision,
  current: CurrentEvidence,
) {
  if (input.privacyRevision !== current.privacyRevision)
    return "privacy_changed";
  if (
    input.messages.some(
      (message) => current.messages.get(message.id) !== message.text,
    )
  )
    return "message_changed_or_removed";
  if (input.frames.length && !current.recentVideo) return "video_stale";
  if (decision.evidenceFrameIds.some((id) => !current.frames.has(id)))
    return "frame_removed";
  if (decision.evidenceTranscriptIds.some((id) => !current.transcripts.has(id)))
    return "speech_removed";
  if (decision.evidenceMessageIds.some((id) => !current.messages.has(id)))
    return "message_removed";
  if (
    decision.replyToMessageId &&
    !current.messages.has(decision.replyToMessageId)
  )
    return "reply_removed";
}
export function publicationProblem(
  candidate: {
    generation: number;
    sessionId: string;
    expires: number;
    input: PublicationInput;
    decision: ReactionDecision;
  },
  current: CurrentEvidence & {
    generation: number;
    sessionId: string;
    now: number;
    running: boolean;
    closed: boolean;
  },
) {
  if (current.closed) return "broadcast_closed";
  if (!current.running) return "stopped";
  if (candidate.sessionId !== current.sessionId) return "broadcast_changed";
  if (candidate.generation !== current.generation) return "generation_changed";
  if (candidate.expires <= current.now) return "candidate_expired";
  return evidenceProblem(candidate.input, candidate.decision, current);
}
interface ReviewableInput {
  transcripts?: Array<{ id: string; text: string; capturedAt: number }>;
  newTranscripts?: Array<{ id: string; text: string; capturedAt: number }>;
}
/** Expired background can be dropped; expired cited speech invalidates the draft. */
export function prepareReview<I extends ReviewableInput>(
  input: I,
  decision: ReactionDecision,
  active: ReadonlySet<string>,
) {
  if (
    decision.text === null ||
    decision.evidenceTranscriptIds.some((id) => !active.has(id))
  )
    return undefined;
  return {
    ...input,
    transcripts: input.transcripts?.filter((t) => active.has(t.id)),
    newTranscripts: input.newTranscripts?.filter((t) => active.has(t.id)),
    reviewDraft: decision.text,
  };
}
