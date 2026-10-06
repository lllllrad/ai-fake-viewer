import { readResponsesStream } from "./infrastructure/reactions/responses-stream.ts";
import { modelMessages } from "./infrastructure/reactions/model-messages.ts";
export { modelMessages } from "./infrastructure/reactions/model-messages.ts";
import type {
  ModelInput as GenerationInput,
  Model as GenerationModel,
  ModelResult,
} from "./application/reactions/model-port.ts";
import { setTimeout as sleep } from "node:timers/promises";
import {
  decisionSchema,
  decisionJsonSchema,
  type Decision,
} from "./contracts.ts";
import type { Config } from "./config.ts";
import type { ChatgptAuth } from "./chatgpt-auth.ts";
import { ModelRequestError } from "./model-errors.ts";

export type ModelInput = GenerationInput<Buffer>;
export type Model = GenerationModel<Buffer>;
export type { ModelResult };
export { limitModelConcurrency } from "./application/reactions/model-concurrency.ts";
export { validateDecision } from "./application/reactions/validate-decision.ts";
export const mockModel: Model = async (input, signal) => {
  await sleep(100, undefined, { signal });
  return {
    decision: {
      action: "say",
      text: "[DEMO] 도형이 움직이는 인공 화면이에요.",
      replyToMessageId: null,
      evidenceFrameIds: [input.frames.at(-1)!.id],
      evidenceMessageIds: [],
      evidenceTranscriptIds: [],
    },
    inputTokens: 0,
    outputTokens: 0,
  };
};
export function openaiModel(
  config: Config["ai"],
  options?: {
    endpoint: () => string;
    model: () => string;
    authorize: (input: ModelInput) => void;
    requestId?: (id: string, input: ModelInput) => void;
  },
): Model {
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
    const count = await fetch(`${endpoint}/responses/input_tokens`, {
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
    const counted: any = await count.json();
    if (
      !Number.isInteger(counted.input_tokens) ||
      counted.input_tokens > config.maxInputTokens
    )
      throw Error("Input token budget exceeded");
    signal.throwIfAborted();
    options?.authorize(input);
    const r = await fetch(`${endpoint}/responses`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body),
    });
    const responseRequestId = r.headers.get("x-request-id");
    if (responseRequestId) options?.requestId?.(responseRequestId, input);
    if (!r.ok) throw Error("Model provider request failed");
    const b: any = await r.json();
    if (b.status !== "completed") throw Error("Model response incomplete");
    const text = (b.output ?? [])
      .flatMap((v: any) => (v.type === "message" ? (v.content ?? []) : []))
      .filter((v: any) => v.type === "output_text")
      .map((v: any) => v.text)
      .join("");
    return {
      decision: JSON.parse(text),
      inputTokens: b.usage?.input_tokens,
      outputTokens: b.usage?.output_tokens,
    };
  };
}

export function chatgptModel(
  config: Config["ai"],
  auth: ChatgptAuth,
  request: typeof fetch = fetch,
  options?: {
    authorize: (input: ModelInput) => void;
    requestId?: (id: string, input: ModelInput) => void;
  },
): Model {
  return async (input, signal) => {
    options?.authorize(input);
    const account = auth.active?.clientId;
    const model = auth.active?.model;
    if (!model) throw Error("Select an available ChatGPT model first");
    const body = {
      model,
      store: false,
      stream: true,
      input: modelMessages(input),
      text: {
        format: {
          type: "json_schema",
          name: "persona_decision",
          strict: true,
          schema: decisionJsonSchema,
        },
      },
    };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024)
      throw Error("Model request exceeds local size limit");
    const token = await auth.access();
    signal.throwIfAborted();
    options?.authorize(input);
    if (auth.active?.clientId !== account || auth.active?.model !== model)
      throw Error("ChatGPT account or model changed during authentication");
    const r = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: serialized,
    });
    const requestId = r.headers.get("x-request-id");
    if (requestId) options?.requestId?.(requestId, input);
    if (!r.ok || !r.body)
      throw new ModelRequestError(
        `provider_http_${r.status}`,
        "ChatGPT inference unavailable",
        { status: r.status },
        r.status === 408 || r.status === 429 || r.status >= 500,
      );
    const { output, inputTokens, outputTokens } = await readResponsesStream(
      r.body,
      signal,
    );
    if (inputTokens !== undefined && inputTokens > config.maxInputTokens)
      throw new ModelRequestError(
        "input_token_limit",
        "ChatGPT token budget exceeded",
        { actual: inputTokens, limit: config.maxInputTokens },
      );
    if (outputTokens !== undefined && outputTokens > config.maxOutputTokens)
      throw new ModelRequestError(
        "output_token_limit",
        "ChatGPT token budget exceeded",
        { actual: outputTokens, limit: config.maxOutputTokens },
      );
    let decision: unknown;
    try {
      decision = JSON.parse(output);
    } catch {
      throw Error("ChatGPT decision JSON invalid");
    }
    return {
      decision: decision as Decision,
      inputTokens,
      outputTokens,
    };
  };
}
