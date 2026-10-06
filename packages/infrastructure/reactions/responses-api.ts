import type {
  Model,
  ModelInput,
  ModelLimits,
} from "../../application/reactions/model-port.ts";
import { decisionJsonSchema, type Decision } from "../../contracts/decision.ts";
import { modelMessages } from "./model-messages.ts";
import {
  completedResponseSchema,
  responseText,
  inputTokenCountSchema,
} from "./response-payload.ts";
export function openaiModel<Bytes extends Uint8Array = Uint8Array>(
  config: ModelLimits,
  options?: {
    endpoint: () => string;
    model: () => string;
    authorize: (input: ModelInput<Bytes>) => void;
    requestId?: (id: string, input: ModelInput<Bytes>) => void;
  },
  request: typeof fetch = fetch,
): Model<Bytes> {
  return async (input, signal) => {
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
      throw Error("Model credentials missing");
    options?.authorize(input);
    const endpoint = options?.endpoint() ?? "https://api.openai.com/v1";
    const model = options?.model() ?? process.env.OPENAI_MODEL;
    const messages = modelMessages(input);
    const headers = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    };
    const body = {
      model,
      store: false,
      input: messages,
      text: {
        format: {
          type: "json_schema",
          name: "persona_decision",
          strict: true,
          schema: decisionJsonSchema,
        },
      },
      max_output_tokens: config.maxOutputTokens,
    };
    if (Buffer.byteLength(JSON.stringify(body)) > 8 * 1024 * 1024)
      throw Error("Model request too large");
    signal.throwIfAborted();
    options?.authorize(input);
    const count = await request(`${endpoint}/responses/input_tokens`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: body.model,
        input: messages,
        text: body.text,
      }),
    });
    const countRequestId = count.headers.get("x-request-id");
    if (countRequestId) options?.requestId?.(countRequestId, input);
    if (!count.ok) throw Error("Input token count unavailable");
    const counted = inputTokenCountSchema.parse(await count.json());
    if (
      !Number.isInteger(counted.input_tokens) ||
      counted.input_tokens > config.maxInputTokens
    )
      throw Error("Input token budget exceeded");
    signal.throwIfAborted();
    options?.authorize(input);
    const r = await request(`${endpoint}/responses`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body),
    });
    const responseRequestId = r.headers.get("x-request-id");
    if (responseRequestId) options?.requestId?.(responseRequestId, input);
    if (!r.ok) throw Error("Model provider request failed");
    const raw: unknown = await r.json();
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("status" in raw) ||
      raw.status !== "completed"
    )
      throw Error("Model response incomplete");
    const b = completedResponseSchema.parse(raw);
    const text = responseText(b.output);
    return {
      decision: JSON.parse(text) as Decision,
      inputTokens: b.usage?.input_tokens,
      outputTokens: b.usage?.output_tokens,
    };
  };
}
