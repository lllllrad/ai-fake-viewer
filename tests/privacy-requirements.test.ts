import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Participation } from "../packages/participation.ts";
import { Store } from "../packages/storage.ts";
import { RightsQueue } from "../packages/rights.ts";
import {
  privacyProfileSchema,
  profileIssues,
} from "../packages/privacy-profile.ts";
import {
  approvedProfile,
  privacyMessage,
  activateFixture,
} from "./privacy-fixtures.ts";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
import {
  modelMessages,
  openaiModel,
  type ModelInput,
} from "../packages/model.ts";

function fixture(t: any) {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const p = new Participation(approvedProfile(), "");
  const store = new Store(":memory:", p);
  return { p, store, advance: (ms = 1) => (now += ms) };
}

test("T01–T04, T22: first command starts guidance; a single delivered notice and age declaration precede participation", (t) => {
  const { p, store, advance } = fixture(t);
  try {
    for (const text of [
      "PRIVATE_UNCONSENTED",
      "예시: !동의",
      "'!동의'",
      "!동의\u200b",
    ])
      store.ingestBatch([privacyMessage("u", text, advance())]);
    assert.equal(store.snapshot().messages.length, 0);
    assert.equal(store.db.prepare("SELECT 1 FROM messages").get(), undefined);
    store.ingestBatch([privacyMessage("u", " !동의 ", advance())]);
    const person = p.get("youtube", "fixture", "u")!;
    assert.equal(person.state, "WAITING_CONSENT");
    assert.equal(person.age, "unknown");
    store.ingestBatch([privacyMessage("u", "!동의", advance())]);
    assert.equal(person.stage, 0);
    for (const stage of p.stages()) {
      advance(31000);
      assert.equal(p.notice(person.id).stage, stage);
      p.delivered(person.id);
      store.ingestBatch([privacyMessage("u", "!동의", advance())]);
    }
    assert.equal(person.state, "ACTIVE");
    assert.equal(person.age, "self_declared_14_plus");
    store.ingestBatch([privacyMessage("u", "새로 보낸 채팅", advance())]);
    assert.equal(store.snapshot().messages.length, 1);
    assert.throws(() => store.grantConsent("youtube", "fixture", "other"));
  } finally {
    store.close();
  }
});

test("T05–T08: identities are scoped, old/duplicate consent cannot revive withdrawal, new generations exclude old messages", (t) => {
  const { p, store, advance } = fixture(t);
  try {
    const person = activateFixture(store, "u", advance);
    const oldConsent = privacyMessage("u", "!동의", advance());
    store.ingestBatch([oldConsent]);
    store.ingestBatch([privacyMessage("u", "PRIVATE_OLD", advance())]);
    const oldId = store.snapshot().messages[0]!.id,
      oldEpoch = person.epoch;
    store.ingestBatch([
      privacyMessage("other", "PRIVATE_SAME_NAME", advance(), {
        name: "Synthetic u",
      }),
      privacyMessage("u", "PRIVATE_OTHER_PLATFORM", advance(), {
        platform: "soop",
      }),
      privacyMessage("u", "PRIVATE_OTHER_ROOM", advance(), {
        channel: "other",
      }),
    ]);
    assert.equal(store.snapshot().messages.length, 1);
    store.ingestBatch([privacyMessage("u", "!철회", advance())]);
    assert.equal(person.state, "WITHDRAWN");
    assert.ok(person.epoch > oldEpoch);
    store.ingestBatch([oldConsent]);
    assert.equal(person.state, "WITHDRAWN");
    assert.equal(person.observed, undefined);
    const again = activateFixture(store, "u", advance);
    assert.equal(again.state, "ACTIVE");
    assert.equal(store.publicMessage(oldId), null);
    store.ingestBatch([
      privacyMessage("u", "PRIVATE_REPLAY", oldConsent.publishedAt!),
    ]);
    assert.equal(store.snapshot().messages.length, 0);
    store.ingestBatch([privacyMessage("u", "새 세대 채팅", advance())]);
    assert.equal(store.snapshot().messages.length, 1);
    store.newSession();
    assert.equal(p.participants.size, 0);
    store.ingestBatch([oldConsent]);
    assert.notEqual(p.get("youtube", "fixture", "u")?.state, "ACTIVE");
  } finally {
    store.close();
  }
});

test("T03, T06, T07: unordered SDK commands need specific live observation confirmation; administrator cannot invent consent", (t) => {
  const { p, store, advance } = fixture(t);
  try {
    store.ingestBatch([
      privacyMessage("u", "!동의", advance(), {
        sourceId: null,
        publishedAt: null,
      }),
    ]);
    const person = p.get("youtube", "fixture", "u")!;
    assert.equal(person.state, "WAITING_CONSENT");
    assert.throws(() => p.confirmLiveCommand(person.id, "nonexistent"));
    p.confirmLiveCommand(person.id, person.observed!.id);
    assert.equal(person.state, "WAITING_CONSENT");
    for (const _ of p.stages()) {
      advance(31000);
      p.delivered(person.id);
      store.ingestBatch([
        privacyMessage("u", "!동의", advance(), {
          sourceId: null,
          publishedAt: null,
        }),
      ]);
      p.confirmLiveCommand(person.id, person.observed!.id);
    }
    assert.equal(person.state, "ACTIVE");
    assert.ok(person.accepted.includes("manual_live_order"));
    p.connectionLost("youtube");
    assert.equal(person.state, "WITHDRAWN");
  } finally {
    store.close();
  }
});

test("T13–T16: validated anonymous categories survive withdrawal but are erased at session end", (t) => {
  const { p, store, advance } = fixture(t);
  const dir = mkdtempSync(join(tmpdir(), "strict-memory-")),
    path = join(dir, "must-not-exist.sqlite");
  try {
    for (const account of ["a", "b", "c"])
      activateFixture(store, account, advance);
    for (const account of ["a", "b", "c"])
      store.ingestBatch([
        privacyMessage(account, "코드 오류? PRIVATE_PERSONAL_STORY", advance()),
      ]);
    const summary = store.chatSummary();
    assert.equal(summary.state, "available");
    assert.deepEqual(summary.topics, ["개발·기술"]);
    assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
    store.reveal();
    store.ingestBatch([privacyMessage("a", "!철회", advance())]);
    assert(
      !JSON.stringify(store.snapshot().identities).includes("Synthetic a"),
    );
    assert(
      !JSON.stringify(
        store.db
          .prepare("SELECT payload FROM events WHERE type='identity.revealed'")
          .all(),
      ).includes("Synthetic a"),
    );
    assert.deepEqual(store.chatSummary().topics, ["개발·기술"]);
    assert.equal(
      JSON.stringify(store.context(["youtube"])).includes("Synthetic"),
      false,
    );
    store.readerCollisionNames.add("synthetic-name-cache");
    store.closeSession();
    assert.equal(store.readerCollisionNames.size, 0);
    assert.equal(p.participants.size, 0);
    assert.equal(store.snapshot().messages.length, 0);
    assert.equal(store.chatSummary().state, "insufficient_data");
    const next = new Store(path, new Participation(approvedProfile(), ""));
    assert.equal(existsSync(path), true);
    assert.equal(next.snapshot().messages.length, 0);
    next.close();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T21–T22: failed delivery, rate limits, bot users and age blocking cannot activate participation", (t) => {
  const { p, store, advance } = fixture(t);
  try {
    p.profile.notices.botUserIds = ["bot"];
    store.ingestBatch([privacyMessage("bot", "!동의", advance())]);
    assert.equal(p.get("youtube", "fixture", "bot"), undefined);
    store.ingestBatch([privacyMessage("u", "!동의", advance())]);
    const person = p.get("youtube", "fixture", "u")!;
    p.profile.notices.approvedLimitConfirmed = false;
    assert.throws(() => p.delivered(person.id));
    assert.equal(person.deliveredAt, null);
    p.profile.notices.approvedLimitConfirmed = true;
    advance(31000);
    p.delivered(person.id);
    assert.throws(() => p.delivered(person.id));
    p.blockAge(person.id);
    store.ingestBatch([privacyMessage("u", "!동의", advance())]);
    assert.equal(person.state, "WITHDRAWN");
    assert.equal(person.age, "blocked");
  } finally {
    store.close();
  }
});

test("T20, T25, T26: no inherited approval defaults, incomplete/mismatched profiles fail closed and updates revoke epochs", (t) => {
  assert.ok(profileIssues(privacyProfileSchema.parse({})).length > 0);
  const { p, store, advance } = fixture(t);
  try {
    const person = activateFixture(store, "u", advance),
      epoch = person.epoch;
    const changed = { ...approvedProfile(), noticeVersion: "fixture-2" };
    p.replaceProfile(changed);
    assert.equal(person.state, "WITHDRAWN");
    assert.ok(person.epoch > epoch);
    assert.equal(p.allowed("youtube", "fixture", "u", epoch), false);
    for (const profile of [
      { ...approvedProfile(), overseasBasis: "unconfirmed" as const },
      {
        ...approvedProfile(),
        processing: { ...approvedProfile().processing, countries: [] },
      },
      {
        ...approvedProfile(),
        processing: {
          ...approvedProfile().processing,
          noticeMatchesConfiguration: false,
        },
      },
    ])
      assert.ok(profileIssues(profile).length);
  } finally {
    store.close();
  }
});

test("T23–T24: durable exception queue contains no chat and cannot confuse local deletion with complete external/video action", () => {
  const dir = mkdtempSync(join(tmpdir(), "rights-fixture-")),
    path = join(dir, "rights.sqlite");
  let rights = new RightsQueue(path);
  try {
    const task = rights.create(
      {
        platform: "soop",
        account: "fixture-account",
        session: "fixture-session",
      },
      ["req-fixture"],
      true,
    );
    assert.equal(task.state, "external_pending");
    assert.throws(() =>
      rights.update(task.id, {
        state: "completed",
        appDone: true,
        providerDone: false,
        videoDone: false,
        copiesDone: false,
        outcome: "pending",
      }),
    );
    rights.close();
    rights = new RightsQueue(path);
    assert.equal(rights.list()[0].id, task.id);
    rights.update(task.id, {
      state: "completed",
      appDone: true,
      providerDone: true,
      videoDone: true,
      copiesDone: true,
      outcome: "no_identifiable_data",
    });
    rights.remove(task.id);
    assert.equal(rights.list().length, 0);
    rights.video({
      platform: "youtube",
      url: "https://example.test/fixture-video",
      broadcastAt: "2026-10-06",
      status: "public",
    });
    assert.equal(rights.videos().length, 1);
  } finally {
    rights.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T10, T19–T20: endpoint stays pinned, no automatic fallback, and authorization is rechecked after token counting", async (t) => {
  const original = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture-model";
  let valid = true;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any) => {
    requests.push(String(url));
    valid = false;
    return Response.json({ input_tokens: 5 });
  });
  const input: ModelInput = {
    frames: [],
    messages: [],
    persona: { name: "test", style: "test" },
    description: "fixture",
  };
  try {
    const run = openaiModel(configSchema.parse({}).ai, {
      endpoint: () => "https://eu.api.openai.com/v1",
      model: () => "fixture-model",
      authorize: () => {
        if (!valid) throw Error("revoked");
      },
    });
    await assert.rejects(run(input, new AbortController().signal), /revoked/);
    assert.deepEqual(requests, [
      "https://eu.api.openai.com/v1/responses/input_tokens",
    ]);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
  }
});

test("T16–T19, T23: live app blocks alternative inputs/export and creates automatic withdrawal follow-up without another email", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const dir = mkdtempSync(join(tmpdir(), "private-app-"));
  const env = await createApp(
    configSchema.parse({
      database: join(dir, "raw.sqlite"),
      privacy: {
        ...approvedProfile(),
        rightsDatabase: join(dir, "rights.sqlite"),
      },
      ai: { provider: "openai_api" },
    }),
    {
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(dir, "chatgpt"),
      youtubeTokenPath: join(dir, "youtube.tokens"),
      soopTokenPath: join(dir, "soop"),
      chzzkTokenPath: join(dir, "chzzk"),
    },
  );
  const headers = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"a".repeat(64)}`,
  };
  try {
    activateFixture(env.store, "u", (ms) => (now += ms));
    env.store.ingestBatch([privacyMessage("u", "PRIVATE_RAW", ++now)]);
    assert.equal(existsSync(join(dir, "raw.sqlite")), true);
    for (const path of ["chatgpt/authorize"]) {
      const response = await env.app.inject({
        method: "POST",
        url: `/api/admin/${path}`,
        headers,
      });
      assert.equal(response.statusCode, 409);
    }
    assert.equal(
      (await env.app.inject({ url: "/api/admin/transcripts/export", headers }))
        .statusCode,
      200,
    );
    env.store.ingestBatch([privacyMessage("u", "!철회", ++now)]);
    assert.equal(env.rights.list().length, 1);
    assert.equal(env.rights.list()[0].state, "external_pending");
    assert.equal(
      JSON.stringify(env.rights.list()).includes("PRIVATE_RAW"),
      false,
    );
    const end = await env.app.inject({
      method: "POST",
      url: "/api/admin/session/close",
      headers,
    });
    assert.equal(end.statusCode, 200);
    assert.equal(env.store.snapshot().messages.length, 0);
    assert.equal(env.participation!.participants.size, 0);
    assert.equal(env.rights.list().length, 1);
  } finally {
    await env.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("receiver approval is checked against the resolved YouTube broadcaster before reading chat", async (t) => {
  const { runYoutube } = await import("../packages/youtube.ts");
  const { store } = fixture(t);
  const oldKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "synthetic-key";
  const requests: string[] = [],
    states: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any) => {
    requests.push(String(url));
    return Response.json({
      items: [
        {
          snippet: { channelId: "unapproved-broadcaster" },
          liveStreamingDetails: { activeLiveChatId: "synthetic-chat" },
        },
      ],
    });
  });
  try {
    await runYoutube(
      { video: "abcdefghijk", transport: "rest", restFallback: false },
      store,
      new AbortController().signal,
      (s) => states.push(s),
    );
    assert.deepEqual(states, ["privacy_blocked"]);
    assert.equal(requests.length, 1);
    assert(!requests.some((url) => url.includes("liveChat/messages")));
    store.deleteAll();
    assert.equal(store.participation!.sessionId, store.sessionId);
  } finally {
    if (oldKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = oldKey;
    store.close();
  }
});

test("delta: actual nicknames remain visible without disclosure and never become model author metadata", (t) => {
  const { store, advance } = fixture(t);
  try {
    for (const id of ["private-id-a", "private-id-b"]) {
      activateFixture(store, id, advance);
      store.ingestBatch([
        privacyMessage(
          id,
          `message ${id.endsWith("a") ? "A" : "B"}`,
          advance(),
          { name: "@실제닉네임" },
        ),
      ]);
    }
    store.ingestBatch([
      privacyMessage("unconsented-id", "hidden text", advance(), {
        name: "@실제닉네임",
      }),
    ]);
    const before = store.readerSnapshot().messages;
    assert.equal(before.length, 2);
    assert(
      before.every(
        (m) => m.displayName === "@실제닉네임" && m.attribution === "mixed",
      ),
    );
    assert.notEqual(before[0].actorId, before[1].actorId);
    const payload = JSON.stringify(
      modelMessages({
        frames: [],
        messages: store.context(["youtube"]),
        persona: { name: "synthetic", style: "brief" },
        description: "fixture",
      }),
    );
    assert(!payload.includes("실제닉네임"));
    assert(!payload.includes("private-id"));
    store.reveal();
    assert.deepEqual(
      store.readerSnapshot().messages.map((m) => m.displayName),
      before.map((m) => m.displayName),
    );
    store.ingestBatch([privacyMessage("private-id-a", "!철회", advance())]);
    assert.deepEqual(
      store.readerSnapshot().messages.map((m) => m.text),
      ["message B"],
    );
    assert(!JSON.stringify(store.replay(0)).includes("message A"));
  } finally {
    store.close();
  }
});

test("delta: child restriction survives profile invalidation and withdrawal; commands cannot verify age or override it", (t) => {
  const { p, store, advance } = fixture(t);
  try {
    const person = activateFixture(store, "u", advance);
    assert.equal(person.age, "self_declared_14_plus");
    p.blockAge(person.id);
    p.replaceProfile({ ...approvedProfile(), noticeVersion: "next" });
    store.ingestBatch([privacyMessage("u", "!철회", advance())]);
    for (let i = 0; i < 8; i++)
      store.ingestBatch([privacyMessage("u", "!동의", advance(31000))]);
    assert.equal(person.age, "blocked");
    assert.equal(person.state, "WITHDRAWN");
    assert.throws(() => p.confirmLiveCommand(person.id, "invented"));
    store.ingestBatch([privacyMessage("u", "excluded", advance())]);
    assert.equal(store.readerSnapshot().messages.length, 0);
  } finally {
    store.close();
  }
});

test("delta: unsupported personal details and single-author topics never enter the retained anonymous summary", (t) => {
  const { store, advance } = fixture(t);
  try {
    for (const author of ["a", "b", "c"]) {
      activateFixture(store, author, advance);
      store.ingestBatch([
        privacyMessage(
          author,
          "PRIVATE_NAME PRIVATE_EVENT 010-1234-5678 https://example.test/private",
          advance(),
        ),
      ]);
    }
    store.ingestBatch([privacyMessage("a", "코드 오류", advance())]);
    const summary = store.chatSummary();
    assert.deepEqual(summary.topics, []);
    assert.deepEqual(summary.atmosphere, []);
    for (const author of ["a", "b", "c"])
      store.ingestBatch([privacyMessage(author, "!철회", advance())]);
    const retained = JSON.stringify(store.chatSummary());
    for (const value of ["PRIVATE", "010-", "example.test", "개발·기술"])
      assert(!retained.includes(value));
    assert.equal(store.context(["youtube"]).length, 0);
  } finally {
    store.close();
  }
});

test("delta: changed processing conditions require a new notice version before invalidating consent", (t) => {
  const { p, store, advance } = fixture(t);
  try {
    const person = activateFixture(store, "u", advance);
    const next = {
      ...approvedProfile(),
      processing: {
        ...approvedProfile().processing,
        countries: ["new-country"],
        retention: "new period",
      },
    };
    assert.throws(() => p.replaceProfile(next), /noticeVersion/);
    assert.equal(person.state, "ACTIVE");
    p.replaceProfile({ ...next, noticeVersion: "fixture-2" });
    assert.equal(person.state, "WITHDRAWN");
    assert.equal(p.allowed("youtube", "fixture", "u", person.epoch), false);
  } finally {
    store.close();
  }
});

test("PC01: API-key requests disable response storage and include explicit input history", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY,
    previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_MODEL = "fixture-model";
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  });
  const input: ModelInput = {
    frames: [],
    messages: [
      {
        id: "message",
        speaker: "opaque-session-key",
        text: "Synthetic permitted input",
      },
    ],
    persona: { name: "synthetic", style: "brief" },
    description: "fixture",
  };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    calls++;
    assert.equal(init.headers.Authorization, "Bearer fixture-key");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "fixture-model");
    assert(JSON.stringify(body.input).includes("Synthetic permitted input"));
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.conversation, undefined);
    if (String(url).endsWith("/input_tokens"))
      return Response.json({ input_tokens: 10 });
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(body.store, false);
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                action: "skip",
                text: null,
                replyToMessageId: null,
                evidenceFrameIds: [],
                evidenceMessageIds: [],
                evidenceTranscriptIds: [],
              }),
            },
          ],
        },
      ],
    });
  });
  const run = openaiModel(configSchema.parse({}).ai, {
    endpoint: () => "https://api.openai.com/v1",
    model: () => "fixture-model",
    authorize: () => {},
  });
  assert.equal(
    (await run(input, new AbortController().signal)).decision.action,
    "skip",
  );
  assert.equal(calls, 2);
});
