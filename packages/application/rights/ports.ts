import type { RightsRecord, VideoRecord } from "../../contracts/rights.ts";
export interface RightsRepository {
  transaction<T>(work: () => T): T;
  insert(record: RightsRecord): void;
  receivedFollowup(id: string): boolean;
  acknowledgeFollowup(id: string): void;
  find(id: string): RightsRecord | undefined;
  save(record: RightsRecord): void;
  remove(id: string): void;
  list(): RightsRecord[];
  addVideo(record: VideoRecord): void;
  videos(): VideoRecord[];
  close(): void;
}
export interface RightsRuntime {
  id(): string;
  now(): number;
}
