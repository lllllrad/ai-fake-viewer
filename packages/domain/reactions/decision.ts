export interface ReactionDecision {
  action: "say" | "skip" | "inspect";
  text: string | null;
  replyToMessageId: string | null;
  evidenceFrameIds: string[];
  evidenceMessageIds: string[];
  evidenceTranscriptIds: string[];
}
export interface DecisionEvidence {
  messages: Array<{ id: string }>;
  frames: Array<{ id: string }>;
  transcripts?: Array<{ id: string }>;
}
export function decisionProblem(
  d: ReactionDecision,
  input: DecisionEvidence,
): string | undefined {
  const messages = new Set(input.messages.map((m) => m.id)),
    frames = new Set(input.frames.map((f) => f.id)),
    transcripts = new Set((input.transcripts ?? []).map((t) => t.id));
  if (
    d.evidenceFrameIds.some((id) => !frames.has(id)) ||
    d.evidenceMessageIds.some((id) => !messages.has(id)) ||
    d.evidenceTranscriptIds.some((id) => !transcripts.has(id)) ||
    (d.replyToMessageId && !messages.has(d.replyToMessageId))
  )
    return "Invalid evidence";
  if (d.action === "skip" || d.action === "inspect") {
    if (d.text !== null) return "Skip and inspect must have null text";
    return;
  }
  if (
    !d.text?.trim() ||
    [...d.text].length > 120 ||
    d.text.split("\n").length > 2 ||
    (!d.evidenceFrameIds.length &&
      !d.evidenceTranscriptIds.length &&
      !d.evidenceMessageIds.length)
  )
    return "Invalid output";
  if (
    /[<>]|https?:\/\/|(?:sk-|Bearer\s)[a-zA-Z0-9_-]{12,}|\b\d{3}[- ]\d{3,4}[- ]\d{4}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:system|admin)\s*:/i.test(
      d.text,
    )
  )
    return "Rejected output";
  return;
}
