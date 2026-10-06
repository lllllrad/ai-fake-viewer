import type { ChatSummary } from "./chat-summary.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decisionSchema,
  decisionJsonSchema,
  type Decision,
} from "./contracts.ts";
import type { Frame } from "./capture.ts";
import type { Transcript } from "./transcription.ts";
import type { Config } from "./config.ts";
import type { ChatgptAuth } from "./chatgpt-auth.ts";
import { ModelRequestError } from "./model-errors.ts";
const promptPath = (name: string) => resolve(process.cwd(), "prompts", name);
const answerPrompt = readFileSync(promptPath("answer.md"), "utf8").trim();
const reviewPrompt = readFileSync(promptPath("review.md"), "utf8").trim();

export interface ModelInput {
  frames: Frame[];
  transcripts?: Transcript[];
  newTranscripts?: Transcript[];
  messages: { id: string; speaker: string; text: string }[];
  newMessages?: { id: string; speaker: string; text: string }[];
  privacyRevision?: number;
  chatSummary?: ChatSummary;
  reviewDraft?: string;
  persona: { name: string; style: string };
  description: string;
}
export interface ModelResult {
  decision: Decision;
  inputTokens?: number;
  outputTokens?: number;
}
export type Model = (
  input: ModelInput,
  signal: AbortSignal,
) => Promise<ModelResult>;
export function limitModelConcurrency(model: Model, maximum = 2): Model {
  let active = 0;
  const queue: Array<{
    resolve: (release: () => void) => void;
    reject: (reason: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }> = [];
  const releaseOne = () => {
    while (queue.length) {
      const next = queue.shift()!;
      next.signal.removeEventListener("abort", next.abort);
      if (next.signal.aborted) continue;
      next.resolve(makeRelease());
      return;
    }
    active = Math.max(0, active - 1);
  };
  const makeRelease = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseOne();
    };
  };
  const acquire = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (active < maximum) {
      active++;
      return Promise.resolve(makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
          reject(signal.reason);
        },
      };
      queue.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
    });
  };
  return async (input, signal) => {
    const release = await acquire(signal);
    try {
      signal.throwIfAborted();
      return await model(input, signal);
    } finally {
      release();
    }
  };
}
export function validateDecision(raw: unknown, input: ModelInput) {
  const d = decisionSchema.parse(raw);
  const messages = new Set(input.messages.map((m) => m.id)),
    frames = new Set(input.frames.map((f) => f.id)),
    transcripts = new Set((input.transcripts ?? []).map((t) => t.id));
  if (
    d.evidenceFrameIds.some((id) => !frames.has(id)) ||
    d.evidenceMessageIds.some((id) => !messages.has(id)) ||
    d.evidenceTranscriptIds.some((id) => !transcripts.has(id)) ||
    (d.replyToMessageId && !messages.has(d.replyToMessageId))
  )
    throw Error("Invalid evidence");
  if (d.action === "skip" || d.action === "inspect") {
    if (d.text !== null) throw Error("Skip and inspect must have null text");
    return d;
  }
  if (
    !d.text?.trim() ||
    [...d.text].length > 120 ||
    d.text.split("\n").length > 2 ||
    (!d.evidenceFrameIds.length &&
      !d.evidenceTranscriptIds.length &&
      !d.evidenceMessageIds.length)
  )
    throw Error("Invalid output");
  if (
    /[<>]|https?:\/\/|(?:sk-|Bearer\s)[a-zA-Z0-9_-]{12,}|\b\d{3}[- ]\d{3,4}[- ]\d{4}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:system|admin)\s*:/i.test(
      d.text,
    )
  )
    throw Error("Rejected output");
  return d;
}
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
export function modelMessages(input: ModelInput) {
  return [
    {
      role: "developer",
      content: input.reviewDraft
        ? reviewPrompt
        : answerPrompt
            .replaceAll("{{persona_style}}", input.persona.style)
            .replaceAll(
              "{{visual_instruction}}",
              input.frames.length
                ? "A video frame is present; do not request inspect again."
                : "No frame is present. If visual context is truly necessary, return action inspect with null text; otherwise say using text evidence or skip.",
            ),
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            description: input.description,
            reviewDraft: input.reviewDraft ?? null,
            recentContext: input.messages,
            anonymousChatSummary: input.chatSummary ?? null,
            newMessages: input.newMessages ?? [],
            newTranscripts: (input.newTranscripts ?? []).map((t) => ({
              id: t.id,
              capturedAt: t.capturedAt,
              text: t.text,
            })),
            recentTranscripts: (input.transcripts ?? []).map((t) => ({
              id: t.id,
              capturedAt: t.capturedAt,
              text: t.text,
            })),
            frames: input.frames.map((f) => ({
              id: f.id,
              capturedAt: f.capturedAt,
            })),
          }),
        },
        ...input.frames.map((f) => ({
          type: "input_image",
          image_url: `data:image/jpeg;base64,${f.bytes.toString("base64")}`,
          detail: "high",
        })),
      ],
    },
  ];
}
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
    let completed: any;
    let buffer = "";
    let streamedText = "";
    let size = 0;
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024 * 1024) throw Error("ChatGPT response too large");
        buffer += decoder.decode(part.value, { stream: true });
        let end: number;
        while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const raw = buffer.slice(0, end);
          const match = buffer.slice(end).match(/^\r?\n\r?\n/)!;
          buffer = buffer.slice(end + match[0].length);
          const payload = raw
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!payload || payload === "[DONE]") continue;
          const event = JSON.parse(payload);
          if (
            event.type === "response.failed" ||
            event.type === "response.incomplete" ||
            event.type === "error"
          )
            throw Error("ChatGPT response failed or incomplete");
          if (event.type === "response.output_text.delta") {
            if (typeof event.delta !== "string")
              throw Error("Invalid ChatGPT text delta");
            streamedText += event.delta;
            if (streamedText.length > 10000)
              throw Error("ChatGPT output too large");
          }
          if (event.type === "response.completed") completed = event.response;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!completed || completed.status !== "completed")
      throw Error("ChatGPT stream ended before completion");
    const completedText = (completed.output ?? [])
      .flatMap((v: any) => (v.type === "message" ? (v.content ?? []) : []))
      .filter((v: any) => v.type === "output_text")
      .map((v: any) => v.text)
      .join("");
    const output = completedText || streamedText;
    if (!output || output.length > 10000)
      throw Error(output ? "ChatGPT output too large" : "ChatGPT output empty");
    const usage = completed.usage;
    if (usage?.input_tokens > config.maxInputTokens)
      throw new ModelRequestError(
        "input_token_limit",
        "ChatGPT token budget exceeded",
        { actual: usage.input_tokens, limit: config.maxInputTokens },
      );
    if (usage?.output_tokens > config.maxOutputTokens)
      throw new ModelRequestError(
        "output_token_limit",
        "ChatGPT token budget exceeded",
        { actual: usage.output_tokens, limit: config.maxOutputTokens },
      );
    let decision: unknown;
    try {
      decision = JSON.parse(output);
    } catch {
      throw Error("ChatGPT decision JSON invalid");
    }
    return {
      decision: decision as Decision,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  };
}
