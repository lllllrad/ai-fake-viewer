import type { Model } from "../../application/reactions/model-port.ts";
import { configSchema } from "../../config.ts";
import { chatgptModel } from "../reactions/chatgpt-model.ts";
import { openaiModel } from "../reactions/responses-api.ts";
import { ChatgptAuth } from "../accounts/chatgpt-auth.ts";
import type { LoadedPipeline } from "../reactions/pipeline-profile.ts";

/** Deterministic plumbing fixture, explicitly unsuitable for quality evaluation. */
export const fixtureModel: Model<Buffer> = async (input, signal) => {
  signal.throwIfAborted();
  const speech = input.transcripts?.at(-1);
  const message = input.messages.at(-1);
  const frame = input.frames.at(-1);
  const evidence = !!(speech || message || frame);
  return {
    decision: {
      action: evidence ? "say" : "skip",
      text: evidence
        ? (input.reviewDraft ??
          `[fixture] ${(speech?.text ?? message?.text ?? "합성 화면").slice(0, 70)}`)
        : null,
      replyToMessageId: null,
      evidenceFrameIds: frame ? [frame.id] : [],
      evidenceMessageIds: message ? [message.id] : [],
      evidenceTranscriptIds: speech ? [speech.id] : [],
    },
    inputTokens: 0,
    outputTokens: 0,
  };
};
export function experimentModel(
  provider: "fixture" | "openai_api" | "chatgpt_subscription",
  pipeline: LoadedPipeline,
  sharedAuth?: ChatgptAuth,
) {
  const limits = configSchema.parse({}).ai;
  if (provider === "fixture")
    return { model: fixtureModel, name: "deterministic-fixture" };
  if (provider === "openai_api") {
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
      throw Error(
        "Set OPENAI_API_KEY and OPENAI_MODEL for Responses API experiments",
      );
    return {
      model: openaiModel<Buffer>(limits, {
        endpoint: () => "https://api.openai.com/v1",
        model: () => process.env.OPENAI_MODEL!,
        authorize() {},
        prompts: pipeline.prompts,
      }),
      name: process.env.OPENAI_MODEL,
    };
  }
  const auth =
    sharedAuth ?? new ChatgptAuth(process.env.TOKEN_ENCRYPTION_KEY ?? "");
  const account = auth.active;
  if (!account?.model || !account.accessToken)
    throw Error(
      "Connect Sign in with ChatGPT and select a model in the project first",
    );
  // Read the existing session without refreshing/rotating the shared token file.
  // The server remains the sole owner of persistent account refresh.
  return {
    model: chatgptModel<Buffer>(
      limits,
      {
        active: { clientId: account.clientId, model: account.model },
        async access() {
          if (account.expiresAt <= Date.now() + 60000)
            throw Error(
              "ChatGPT session needs refresh in the running project before this experiment",
            );
          return account.accessToken;
        },
      },
      fetch,
      { authorize() {}, prompts: pipeline.prompts },
    ),
    name: account.model,
  };
}
