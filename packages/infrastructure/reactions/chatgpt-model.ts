import type {
  Model,
  ModelInput,
  ModelLimits,
} from "../../application/reactions/model-port.ts";
import { decisionJsonSchema, type Decision } from "../../contracts/decision.ts";
import { modelMessages, type ModelPrompts } from "./model-messages.ts";
import { readResponsesStream } from "./responses-stream.ts";
import { ModelRequestError } from "../../model-errors.ts";
export interface ChatgptModelAccount {
  readonly active:
    { clientId: string; model?: string | null } | null | undefined;
  access(): Promise<string>;
}
export function chatgptModel<Bytes extends Uint8Array = Uint8Array>(
  config: ModelLimits,
  auth: ChatgptModelAccount,
  request: typeof fetch = fetch,
  options?: {
    prompts?: ModelPrompts;
    authorize: (input: ModelInput<Bytes>) => void;
    requestId?: (id: string, input: ModelInput<Bytes>) => void;
  },
): Model<Bytes> {
  return async (input, signal) => {
    options?.authorize(input);
    const account = auth.active?.clientId;
    const model = auth.active?.model;
    if (!model) throw Error("Select an available ChatGPT model first");
    const body = {
      model,
      store: false,
      stream: true,
      input: modelMessages(input, options?.prompts),
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
