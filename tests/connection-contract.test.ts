import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizationLinkSchema,
  readerLinksSchema,
  modelListSchema,
} from "../packages/contracts/connections.ts";
test("connection destinations require web URLs and drop undeclared credential fields", () => {
  const valid = authorizationLinkSchema.parse({
    url: "https://accounts.example.invalid/authorize",
    accessToken: "synthetic-private-value",
  });
  assert.deepEqual(valid, {
    url: "https://accounts.example.invalid/authorize",
  });
  for (const url of ["/relative", "data:text/plain,fixture", "file:///fixture"])
    assert.equal(authorizationLinkSchema.safeParse({ url }).success, false);
  assert.equal(
    readerLinksSchema.safeParse({
      reader: "http://127.0.0.1:3210/reader#fixture",
      overlay: "http://127.0.0.1:3210/overlay#fixture",
    }).success,
    true,
  );
});
test("model choices must include usable identifiers and labels", () => {
  assert.equal(
    modelListSchema.safeParse({ models: [{ slug: "", name: "Fixture" }] })
      .success,
    false,
  );
  assert.equal(
    modelListSchema.safeParse({ models: [{ slug: "fixture" }] }).success,
    false,
  );
  assert.deepEqual(
    modelListSchema.parse({
      models: [
        { slug: "fixture", name: "Fixture", privateMetadata: "ignored" },
      ],
    }),
    { models: [{ slug: "fixture", name: "Fixture" }] },
  );
});
