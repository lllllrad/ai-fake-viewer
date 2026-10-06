import type { Participant } from "../../domain/participation/model.ts";
import type { PrivacyProfile } from "../../contracts/privacy-profile.ts";

export interface ParticipationRuntime {
  now(): number;
  id(): string;
  fingerprint(profile: PrivacyProfile): string;
}
/** The bound adapter owns durable state and dependent chat deletion in one transaction. */
export interface ParticipationPersistence {
  run<T>(work: () => T): T;
  save(): void;
  eraseContext(participant: Participant): void;
  afterCommit(effect: () => void): void;
}
