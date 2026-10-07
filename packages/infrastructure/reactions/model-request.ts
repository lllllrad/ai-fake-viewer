import type {
  ModelInput,
  ModelResult,
} from "../../application/reactions/model-port.ts";
import {
  modelToolSchema,
  continuationItemSchema,
} from "../../contracts/model-tools.ts";
import { modelMessages, type ModelPrompts } from "./model-messages.ts";
import { decisionJsonSchema } from "../../contracts/decision.ts";

/** One payload projection for actual calls and test inspection. */
export function modelRequest(input: ModelInput, prompts?: ModelPrompts) {
  const messages: unknown[] = [...modelMessages(input, prompts)];
  if (input.continuation?.length)
    messages.push(
      ...continuationItemSchema.array().max(64).parse(input.continuation),
    );
  if (input.tools?.length)
    return {
      input: messages,
      tools: modelToolSchema.array().min(1).max(16).parse(input.tools),
      tool_choice: "required" as const,
      parallel_tool_calls: true,
      include: ["reasoning.encrypted_content"],
      ...(input.contextKey
        ? { prompt_cache_key: input.contextKey.slice(0, 64) }
        : {}),
    };
  return {
    input: messages,
    text: {
      format: {
        type: "json_schema" as const,
        name: "persona_decision",
        strict: true,
        schema: decisionJsonSchema,
      },
    },
  };
}
/** Encrypted reasoning is transport state, not visible thoughts or an inspection artifact. */
export function inspectedModelRequest(
  input: ModelInput,
  prompts?: ModelPrompts,
) {
  const body = modelRequest(input, prompts);
  return {
    ...body,
    input: body.input.map((item: any) =>
      item?.type === "reasoning"
        ? { type: "reasoning", encrypted: !!item.encrypted_content }
        : item,
    ),
  };
}

export function inspectedModelResult(result: ModelResult) {
  const { continuation: _continuation, ...visible } = result;
  return visible;
}
