export interface ContextMessage {
  id: string;
  speaker: string;
  text: string;
}
export interface ObservedMessage {
  id: string;
  displayTime: number;
  seq: number;
  attribution: string;
}
export interface TimedEvidence {
  id: string;
  capturedAt: number;
}
export interface SpeechEvidence extends TimedEvidence {
  text: string;
}
export function messageVersion(message: ContextMessage) {
  return `${message.speaker}\n${message.text}`;
}

/** Context and unconsumed triggers are separate; selection never consumes either. */
export function selectEvidenceWindow<T extends SpeechEvidence>(input: {
  now: number;
  windowMs: number;
  transcriptLimit?: number;
  recent: Array<ObservedMessage | null>;
  messages: ContextMessage[];
  transcripts: T[];
  allowedPlatforms: string[];
  processedTranscriptIds: ReadonlySet<string>;
  processedMessageVersions: ReadonlyMap<string, string>;
}) {
  const floor = input.now - input.windowMs;
  const recent = input.recent.filter(
    (message): message is ObservedMessage =>
      message !== null && message.displayTime >= floor,
  );
  const recentIds = new Set(recent.map((message) => message.id));
  const messages = input.messages.filter((message) =>
    recentIds.has(message.id),
  );
  const transcripts = input.transcripts
    .filter((t) => t.capturedAt >= floor)
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .slice(-(input.transcriptLimit ?? 10));
  const transcriptIds = new Set(transcripts.map((t) => t.id));
  const messageIds = new Set(messages.map((message) => message.id));
  const processedTranscriptIds = new Set(
    [...input.processedTranscriptIds].filter((id) => transcriptIds.has(id)),
  );
  const processedMessageVersions = new Map(
    [...input.processedMessageVersions].filter(([id]) => messageIds.has(id)),
  );
  const newTranscripts = transcripts.filter(
    (t) => !processedTranscriptIds.has(t.id),
  );
  const newMessages = messages.filter(
    (message) =>
      processedMessageVersions.get(message.id) !== messageVersion(message),
  );
  const external = recent.filter(
    (message) => message.attribution !== "experiment",
  );
  const latest = external.findLast(
    (message) =>
      input.allowedPlatforms.includes(message.attribution) &&
      newMessages.some((candidate) => candidate.id === message.id),
  );
  return {
    recent,
    messages,
    transcripts,
    newMessages,
    newTranscripts,
    processedTranscriptIds,
    processedMessageVersions,
    triggerMessage: newMessages.find((message) => message.id === latest?.id),
    newExternalMessages: newMessages.filter((message) =>
      external.some(
        (event) =>
          event.id === message.id &&
          input.allowedPlatforms.includes(event.attribution),
      ),
    ),
    externalSequence: external.at(-1)?.seq ?? 0,
    recentExternalCount: external.filter(
      (message) => message.displayTime > input.now - 60000,
    ).length,
  };
}
export function baselinePacingBlocked(
  recentExternalCount: number,
  speechTimes: readonly number[],
  now: number,
) {
  return (
    recentExternalCount > 15 ||
    speechTimes.filter((at) => at > now - 60000).length >= 3
  );
}
