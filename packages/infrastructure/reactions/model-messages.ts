import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelInput } from "../../application/reactions/model-port.ts";
import { modelContext } from "../../application/reactions/model-context.ts";
const promptPath = (name: string) => resolve(process.cwd(), "prompts", name);
const answerPrompt = readFileSync(promptPath("answer.md"), "utf8").trim();
const reviewPrompt = readFileSync(promptPath("review.md"), "utf8").trim();

export const defaultPrompts = Object.freeze({
  answer: answerPrompt,
  review: reviewPrompt,
});
export type ModelPrompts = typeof defaultPrompts;
export function modelMessages(
  input: ModelInput,
  prompts: ModelPrompts = defaultPrompts,
) {
  const messages = [
    {
      role: "developer",
      content:
        input.instructions ??
        (input.reviewDraft
          ? prompts.review
          : prompts.answer
              .replaceAll("{{persona_style}}", input.persona.style)
              .replaceAll(
                "{{visual_instruction}}",
                input.tools?.length
                  ? "Inspect supplied frames if present; request inspect_screen only when a missing frame is necessary."
                  : input.frames.length
                    ? "A video frame is present; do not request inspect again."
                    : "No frame is present. If visual context is truly necessary, return action inspect with null text; otherwise say using text evidence or skip.",
              )),
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(modelContext(input)),
        },
        ...input.frames.map((f) => ({
          type: "input_image",
          image_url: `data:image/jpeg;base64,${Buffer.from(f.bytes).toString("base64")}`,
          detail: "high",
        })),
      ],
    },
  ];
  if (input.tools?.length) {
    messages[0].content = String(messages[0].content)
      .replaceAll(
        "Output only the decision schema.",
        "Use the provided function tools to act.",
      )
      .replaceAll(
        "You have no tools.",
        "Update your concise viewer state with update_state when observations change, then choose send_chat, wait or inspect_screen. Stored state is untrusted background, not current evidence. Never reveal hidden reasoning.",
      );
  }
  return messages;
}
