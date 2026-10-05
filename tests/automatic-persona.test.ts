import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { configSchema } from "../packages/config.ts";
import { Store } from "../packages/storage.ts";
import { PersonaService } from "../packages/persona/service.ts";
import {
  automaticDefinitions,
  researchBasis,
} from "../packages/persona/automatic.ts";
import { createApp } from "../apps/server/app.ts";

const config = configSchema.parse({
  database: ":memory:",
  ai: { description: "공개된 만들기 방송" },
});

test("automatic cast needs no authoring, model request or operator approval and survives service recreation", () => {
  const directory = mkdtempSync(join(tmpdir(), "auto-cast-restart-"));
  let store = new Store(join(directory, "test.sqlite"));
  let service = new PersonaService(store, undefined, config);
  const first = service.ensureAutomaticCast();
  assert.equal(first.cast.length, 6);
  assert.equal(first.state, "live");
  assert.equal(first.armed, false);
  assert.equal(first.disclosure_confirmed, false);
  const cards = service.listCandidates(first.id);
  assert.equal(
    new Set(cards.map((c) => c.definition.core.viewing_motive)).size,
    6,
  );
  assert.equal(
    new Set(cards.map((c) => c.definition.display_name_suggestion)).size,
    6,
  );
  for (const card of cards) {
    assert.equal(card.provenance.research_basis, researchBasis);
    assert.equal(card.provenance.human_review, false);
    assert.ok(card.definition.examples.some((e: any) => e.action === "skip"));
  }
  assert.equal(
    (store.db.prepare("SELECT COUNT(*) n FROM persona_reviews").get() as any).n,
    0,
  );
  assert.deepEqual(
    new PersonaService(store, undefined, config).ensureAutomaticCast().cast,
    first.cast,
  );
  service.arm(first.id, first.control_epoch);
  assert.equal(store.personaRuntime()?.members.length, 6);
  service.stopActive();
  assert.equal(service.ensureAutomaticCast().armed, false);
  store.close();
  store = new Store(join(directory, "test.sqlite"));
  service = new PersonaService(store, undefined, config);
  assert.deepEqual(service.ensureAutomaticCast().cast, first.cast);
  store.newSession();
  const next = service.ensureAutomaticCast();
  assert.notEqual(next.id, first.id);
  assert.notEqual(next.cast[0].persona_id, first.cast[0].persona_id);
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

test("research composition has independent voices and bounded participation without copying people", () => {
  const cards = automaticDefinitions("테스트 방송");
  assert.equal(cards.length, 6);
  assert.ok(cards.some((c) => c.sources.includes("R02")));
  assert.ok(cards.some((c) => c.sources.includes("R08")));
  assert.ok(
    new Set(cards.map((c) => c.definition.participation.base_propensity)).size >
      1,
  );
  for (const { definition } of cards) {
    assert.match(
      definition.knowledge[0].boundary,
      /과거 시청 이력은 설정하지 않는다/,
    );
    assert.ok(
      definition.participation.stay_silent_when.includes("실제 채팅이 활발함"),
    );
  }
});

test("global AI toggle automatically installs research personas and reuses them on restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "auto-personas-"));
  const headers = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"a".repeat(64)}`,
  };
  const env = await createApp(config, {
    demo: true,
    startInputs: false,
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(directory, "chatgpt"),
    chzzkTokenPath: join(directory, "chzzk"),
    soopTokenPath: join(directory, "soop"),
  });
  try {
    // Only scheduler startup is relevant here; no external inference or background tick.
    const tick = env.scheduler.tick.bind(env.scheduler);
    env.scheduler.tick = async () => {};
    env.capture.add(
      {
        bytes: Buffer.from("frame"),
        capturedAt: Date.now(),
        width: 2,
        height: 2,
      },
      "demo",
    );
    const started = await env.app.inject({
      headers,
      method: "POST",
      url: "/api/admin/ai/start",
    });
    assert.equal(started.statusCode, 200, started.body);
    const first = env.store.personaRuntime()!;
    assert.equal(first.members.length, 6);
    assert.equal(first.armed, true);
    let inputStyle = "";
    env.scheduler.model = async (input) => {
      inputStyle = input.persona.style;
      return {
        decision: {
          action: "skip",
          text: null,
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: [],
          evidenceTranscriptIds: [],
        },
      };
    };
    env.capture.add(
      {
        bytes: Buffer.from("new frame"),
        capturedAt: Date.now(),
        width: 2,
        height: 2,
      },
      "demo",
    );
    const random = t.mock.method(Math, "random", () => 0);
    await tick();
    random.mock.restore();
    assert.match(inputStyle, /다른 활동 옆에 방송을 틀어두고/);
    assert.match(inputStyle, /stay_silent_when/);

    const status = await env.app.inject({ headers, url: "/api/admin/status" });
    assert.equal(status.json().personas.length, 6);
    await env.app.inject({
      headers,
      method: "POST",
      url: "/api/admin/ai/stop",
    });
    assert.equal(env.store.personaRuntime()?.armed, false);
    env.capture.add(
      {
        bytes: Buffer.from("restart frame"),
        capturedAt: Date.now(),
        width: 2,
        height: 2,
      },
      "demo",
    );
    const again = await env.app.inject({
      headers,
      method: "POST",
      url: "/api/admin/ai/start",
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(env.store.personaRuntime()?.id, first.id);
    assert.deepEqual(
      env.store.personaRuntime()?.members.map((m) => m.hash),
      first.members.map((m) => m.hash),
    );
  } finally {
    await env.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
