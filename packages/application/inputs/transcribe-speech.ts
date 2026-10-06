export interface Transcript {
  id: string;
  capturedAt: number;
  text: string;
}
export type SpeechFailureCode =
  "quota_blocked" | "auth_required" | "provider_error";
export class SpeechProviderError extends Error {
  constructor(public readonly code: SpeechFailureCode) {
    super(code);
  }
}
export type TranscriptionOutcome =
  | { kind: "published"; entry: Transcript }
  | { kind: "canceled" | "empty" | "discarded" }
  | { kind: "failed"; state: SpeechFailureCode | "storage_error" };
/** Reserve durable request usage before external processing; publish only current context. */
export async function transcribeSpeech(options: {
  capturedAt: number;
  current(): boolean;
  reserve(): void;
  request(): Promise<string>;
  publish(entry: Transcript): boolean;
  id(): string;
}): Promise<TranscriptionOutcome> {
  if (!options.current()) return { kind: "canceled" };
  try {
    options.reserve();
  } catch {
    return { kind: "failed", state: "storage_error" };
  }
  if (!options.current()) return { kind: "canceled" };
  let raw: string;
  try {
    raw = await options.request();
  } catch (error) {
    if (!options.current()) return { kind: "canceled" };
    return {
      kind: "failed",
      state:
        error instanceof SpeechProviderError ? error.code : "provider_error",
    };
  }
  if (!options.current()) return { kind: "canceled" };
  const text = raw.trim().slice(0, 1000);
  if (!text) return { kind: "empty" };
  const entry = { id: options.id(), capturedAt: options.capturedAt, text };
  try {
    if (!options.publish(entry)) return { kind: "discarded" };
  } catch {
    return { kind: "failed", state: "storage_error" };
  }
  return { kind: "published", entry };
}
