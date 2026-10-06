import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelInput } from "../../application/reactions/model-port.ts";
import { modelContext } from "../../application/reactions/model-context.ts";
const promptPath = (name: string) => resolve(process.cwd(), "prompts", name);
const answerPrompt = readFileSync(promptPath("answer.md"), "utf8").trim();
const reviewPrompt = readFileSync(promptPath("review.md"), "utf8").trim();

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
}
