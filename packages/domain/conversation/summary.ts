export type ChatSummary = {
  version: 1;
  state: "available" | "insufficient_data";
  topics: string[];
  atmosphere: string[];
  activity: "unknown" | "quiet" | "active" | "busy";
};
/** Empty compatibility field for the v1 AI service protocol. */
export function emptyChatSummary(): ChatSummary {
  return {
    version: 1,
    state: "insufficient_data",
    topics: [],
    atmosphere: [],
    activity: "unknown",
  };
}
