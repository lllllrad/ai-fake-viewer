import {
  transcriptSchema,
  type Transcript,
  type StoredTranscript,
} from "../../contracts/transcript.ts";
export interface TranscriptRepository {
  insert(sessionId: string, entry: Transcript): void;
  recent(sessionId: string, since: number, limit: number): Transcript[];
  clearAll(): void;
  countAll(): number;
  latestRows(limit: number): StoredTranscript[];
  allRows(): Iterable<StoredTranscript>;
}
/** Owns durable speech admission and recovery; raw audio never enters this journal. */
export class TranscriptJournal {
  constructor(
    private readonly repository: TranscriptRepository,
    private readonly runtime: {
      sessionId(): string;
      closed(): boolean;
      now(): number;
    },
  ) {}
  record(input: Transcript) {
    if (this.runtime.closed()) return false;
    const entry = transcriptSchema.parse(input);
    this.repository.insert(this.runtime.sessionId(), entry);
    return true;
  }
  recent() {
    if (this.runtime.closed()) return [];
    return this.repository.recent(
      this.runtime.sessionId(),
      this.runtime.now() - 120000,
      12,
    );
  }
  clear() {
    this.repository.clearAll();
  }
  count() {
    return this.repository.countAll();
  }
  rows(limit = 10) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000)
      throw new Error("Invalid transcript row limit");
    return this.repository.latestRows(limit);
  }
  *export() {
    for (const row of this.repository.allRows())
      yield JSON.stringify(row) + "\n";
  }
}
