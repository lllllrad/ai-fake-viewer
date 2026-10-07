import { z } from "zod";
import {
  decisionJsonSchema,
  decisionSchema,
  type Decision,
} from "../../packages/contracts/decision.ts";
import type {
  ModelTool,
  ModelContinuationItem,
} from "../../packages/contracts/model-tools.ts";
import type { DraftOptions } from "../../packages/application/reactions/program.ts";
import { generateReviewedDraft } from "./draft-review.ts";

const stateSchema = z
  .object({
    mood: z.string().trim().min(1).max(160),
    focus: z.string().trim().min(1).max(240),
    intent: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(1600),
  })
  .strict();
const stateProperties = Object.fromEntries(
  ["mood", "focus", "intent", "summary"].map((key) => [
    key,
    { type: "string" },
  ]),
);
const { action: _action, ...chatProperties } = decisionJsonSchema.properties;
const tool = (
  name: string,
  description: string,
  properties: ModelTool["parameters"],
): ModelTool => ({
  type: "function",
  name,
  description,
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  },
});
export const viewerTools: ModelTool[] = [
  tool(
    "update_state",
    "Your initialized state is supplied in viewerState; its initial values are not observed facts. Replace the complete observable viewer state: mood, current focus, next intent and remembered conversation summary. No hidden reasoning. Do not invent facts or retain expired evidence. Update before choosing an action when the conversation changes.",
    stateProperties,
  ),
  tool(
    "send_chat",
    "Submit a chat candidate for host validation, optional review and publication. This does not directly publish. Cite current evidence IDs only.",
    chatProperties,
  ),
  tool("wait", "Choose not to send a chat now.", {}),
  tool(
    "inspect_screen",
    "Request the latest screen before deciding whether to chat. Only when visual context is necessary and no frame is present.",
    {},
  ),
];
const empty = (action: "skip" | "inspect"): Decision => ({
  action,
  text: null,
  replyToMessageId: null,
  evidenceFrameIds: [],
  evidenceMessageIds: [],
  evidenceTranscriptIds: [],
});

/** The service owns tools and sequencing; the host owns state writes and publication. */
export async function generateToolDraft<Bytes extends Uint8Array>(
  options: DraftOptions<Bytes>,
) {
  let memory = options.input.viewerState;
  return generateReviewedDraft({
    ...options,
    model: async (input, signal) => {
      const stageMemory = memory;
      const continuation: ModelContinuationItem[] = [];
      const seen = new Set<string>();
      for (let round = 0; round < 4; round++) {
        signal.throwIfAborted();
        if (!options.isCurrent()) throw Error("Stale tool workflow");
        const request = {
          ...input,
          viewerState: stageMemory,
          tools: viewerTools,
          continuation: [...continuation],
        };
        options.active(request);
        const result = await options.model(request, signal);
        signal.throwIfAborted();
        if (!options.isCurrent()) throw Error("Stale tool workflow");
        // Explicit legacy fixtures and third-party model adapters remain compatible.
        if (!result.toolCalls?.length) {
          if (!result.decision) throw Error("Model returned no action");
          return { decision: result.decision };
        }
        if (result.toolCalls.length > 8) throw Error("Too many tool calls");
        let terminal: Decision | undefined;
        const parsed = result.toolCalls.map((call) => {
          if (seen.has(call.call_id)) throw Error("Duplicate tool call");
          seen.add(call.call_id);
          const args: unknown = JSON.parse(call.arguments);
          if (call.name === "update_state")
            return { call, state: stateSchema.parse(args) };
          const decision =
            call.name === "send_chat"
              ? decisionSchema.parse({
                  ...z.record(z.string(), z.unknown()).parse(args),
                  action: "say",
                })
              : call.name === "wait" || call.name === "inspect_screen"
                ? (z.object({}).strict().parse(args),
                  empty(call.name === "wait" ? "skip" : "inspect"))
                : undefined;
          if (!decision || terminal)
            throw Error("Invalid or conflicting tool action");
          terminal = decision;
          return { call, decision };
        });
        continuation.push(...(result.continuation ?? result.toolCalls));
        for (const item of parsed) {
          if (item.state) {
            if (!options.updateState)
              throw Error("Viewer state port unavailable");
            memory = await options.updateState(item.state);
          }
          options.trace("tool_executed", {
            tool: item.call.name,
            callId: item.call.call_id,
          });
          continuation.push({
            type: "function_call_output",
            call_id: item.call.call_id,
            output: JSON.stringify(
              item.state
                ? {
                    ok: true,
                    revision: memory?.revision,
                    values: memory?.values,
                  }
                : { ok: true, status: "candidate" },
            ),
          });
        }
        if (terminal) return { decision: terminal };
      }
      throw Error("Viewer tool workflow exceeded four rounds");
    },
  });
}
