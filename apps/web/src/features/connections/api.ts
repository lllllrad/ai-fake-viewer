import { adminClient } from "../../lib/admin-client.ts";
import {
  authorizationLinkSchema,
  readerLinksSchema,
  modelListSchema,
} from "../../../../../packages/contracts/connections.ts";
export const connectionApi = {
  authorize: (
    provider: "youtube" | "chzzk" | "soop" | "chatgpt",
    signal: AbortSignal,
    clientId?: string,
  ) =>
    adminClient.json(`${provider}/authorize`, authorizationLinkSchema, {
      method: "POST",
      body: clientId ? { clientId } : {},
      signal,
    }),
  models: (signal: AbortSignal) =>
    adminClient.json("chatgpt/models", modelListSchema, { signal }),
  links: (signal: AbortSignal) =>
    adminClient.json("links", readerLinksSchema, { signal }),
  command: async (path: string, signal: AbortSignal, body?: unknown) => {
    await adminClient.request(path, { method: "POST", signal, body });
  },
};
