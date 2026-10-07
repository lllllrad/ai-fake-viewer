import { randomUUID } from "node:crypto";
import type { Incoming } from "../../packages/contracts/incoming.ts";
export const syntheticMessage = (
  author: string,
  text: string,
  at = Date.now(),
  extra: Partial<Incoming> = {},
): Incoming => ({
  platform: "experiment",
  channel: "fixture",
  author,
  name: "Synthetic " + author,
  text,
  sourceId: randomUUID(),
  publishedAt: at,
  ...extra,
});
