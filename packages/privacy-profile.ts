import type { PrivacyProfile } from "./contracts/privacy-profile.ts";
export {
  privacyProfileSchema,
  type PrivacyProfile,
} from "./contracts/privacy-profile.ts";
export {
  PrivacyActionError,
  SessionProfileMismatchError,
} from "./application/participation/errors.ts";
export {
  profileIssues,
  assertProfileUpdate,
} from "./application/participation/profile.ts";
import { createHash } from "node:crypto";
export function profileFingerprint(p: PrivacyProfile) {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}
