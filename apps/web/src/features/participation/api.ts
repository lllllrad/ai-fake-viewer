import { z } from "zod";
import { adminClient } from "../../lib/admin-client.ts";
import { participationStatusSchema } from "../../../../../packages/contracts/participation.ts";
import {
  rightsRecordSchema,
  videoRecordSchema,
  type RightsIntake,
  type RightsUpdate,
} from "../../../../../packages/contracts/rights.ts";

const ok = z.object({ ok: z.literal(true) });
const participantPath = (id: string, action: string) =>
  `privacy/participants/${encodeURIComponent(id)}/${action}`;
export const participationApi = {
  status: (signal: AbortSignal) =>
    adminClient.json("privacy", participationStatusSchema, { signal }),
  participant: (
    id: string,
    action: "confirm-live-command" | "notice-delivered" | "block-age",
    body: unknown,
    signal: AbortSignal,
  ) =>
    adminClient.json(participantPath(id, action), ok, {
      method: "POST",
      body,
      signal,
    }),
  createRights: (body: RightsIntake, signal: AbortSignal) =>
    adminClient.json("privacy/rights", rightsRecordSchema, {
      method: "POST",
      body,
      signal,
    }),
  updateRights: (id: string, body: RightsUpdate, signal: AbortSignal) =>
    adminClient.json(
      `privacy/rights/${encodeURIComponent(id)}`,
      rightsRecordSchema,
      { method: "PATCH", body, signal },
    ),
  removeRights: (id: string, signal: AbortSignal) =>
    adminClient.json(`privacy/rights/${encodeURIComponent(id)}`, ok, {
      method: "DELETE",
      signal,
    }),
  addVideo: (body: unknown, signal: AbortSignal) =>
    adminClient.json("privacy/videos", videoRecordSchema, {
      method: "POST",
      body,
      signal,
    }),
};
