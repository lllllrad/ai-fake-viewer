import { z } from "zod";
import {
  completedResponseSchema,
  responseText,
  responseTools,
} from "./response-payload.ts";
const eventSchema = z.object({ type: z.string() }).passthrough();
/** Bounded Responses API SSE decoding; transport and decision validation remain separate. */
export async function readResponsesStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  toolMode = false,
) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let completed: z.infer<typeof completedResponseSchema> | undefined;
  let buffer = "",
    streamedText = "",
    size = 0,
    ended = false;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) {
        ended = true;
        break;
      }
      size += part.value.byteLength;
      if (size > 1024 * 1024) throw Error("ChatGPT response too large");
      buffer += decoder.decode(part.value, { stream: true });
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buffer.slice(0, end);
        const boundary = buffer.slice(end).match(/^\r?\n\r?\n/)!;
        buffer = buffer.slice(end + boundary[0].length);
        const payload = raw
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!payload || payload === "[DONE]") continue;
        const event = eventSchema.parse(JSON.parse(payload));
        if (
          ["response.failed", "response.incomplete", "error"].includes(
            event.type,
          )
        )
          throw Error("ChatGPT response failed or incomplete");
        if (event.type === "response.output_text.delta") {
          if (typeof event.delta !== "string")
            throw Error("Invalid ChatGPT text delta");
          streamedText += event.delta;
          if (streamedText.length > 10000)
            throw Error("ChatGPT output too large");
        }
        if (event.type === "response.completed")
          completed = completedResponseSchema.parse(event.response);
      }
    }
    if (!completed) throw Error("ChatGPT stream ended before completion");
    const output = responseText(completed.output) || streamedText;
    const tools = toolMode ? responseTools(completed.output) : undefined;
    if (toolMode && !tools?.calls.length)
      throw Error("Model returned no tool call");
    if ((!toolMode && !output) || output.length > 10000)
      throw Error(output ? "ChatGPT output too large" : "ChatGPT output empty");
    return {
      output,
      ...(tools
        ? {
            toolCalls: tools.calls,
            continuation: tools.continuation,
            cachedInputTokens:
              completed.usage?.input_tokens_details?.cached_tokens,
          }
        : {}),
      inputTokens: completed.usage?.input_tokens,
      outputTokens: completed.usage?.output_tokens,
    };
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!ended) {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the decoding/cancellation error. */
      }
    }
    reader.releaseLock();
  }
}
