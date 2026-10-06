import {
  adminStatusSchema,
  type AdminStatus,
} from "../../contracts/admin-status.ts";

/** Closed broadcast content cannot be exposed by an administrator projection. */
export function projectAdminStatus(input: AdminStatus): AdminStatus {
  const status = adminStatusSchema.parse(input);
  if (!status.closed) return status;
  return {
    ...status,
    messages: [],
    personas: [],
    chatSummary: {
      version: 1,
      state: "insufficient_data",
      topics: [],
      atmosphere: [],
      activity: "unknown",
    },
    audio: {
      ...status.audio,
      history: [],
      latestText: null,
      latestAt: null,
      transcriptCount: 0,
      loggedCount: 0,
    },
    ai: { ...status.ai, pending: null },
  };
}
