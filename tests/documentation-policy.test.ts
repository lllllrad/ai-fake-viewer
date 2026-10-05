import { test } from "node:test";
import assert from "node:assert/strict";
import { documentationIssues } from "../scripts/documentation-policy.ts";

test("documentation policy catches localized prose, examples and headings", () => {
  for (const source of [
    "# \uBB38\uC11C",
    "English\n| \uD55C\uAE00 | text |",
    "```sh\n# \uC8FC\uC11D\n```",
  ])
    assert(
      documentationIssues(source).some((issue) => issue.includes("English")),
    );
});
test("documentation uses official API/auth names while preserving machine values", () => {
  for (const source of [
    "ChatGPT OAuth",
    "ChatGPT subscription API",
    "Responses stream",
    "Sign In With ChatGPT",
    "Continue with ChatGPT",
  ])
    assert(documentationIssues(source).length > 0, source);
  assert.deepEqual(
    documentationIssues(
      "Sign in with ChatGPT authorizes Responses API requests.\n`contract: ChatGPT subscription`\n```yaml\nprovider: chatgpt_subscription\n```",
    ),
    [],
  );
});
