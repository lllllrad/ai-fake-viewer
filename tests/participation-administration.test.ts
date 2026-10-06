import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { ParticipationAdministration } from "../packages/application/participation/administration.ts";
import { ParticipationService } from "../packages/application/participation/service.ts";
import { registerParticipationRoutes } from "../apps/server/http/routes/participation.ts";
import { approvedProfile } from "./privacy-fixtures.ts";
function fixture() {
  let now = 100000;
  const profile = approvedProfile(),
    events: string[] = [];
  const participation = new ParticipationService(profile, "broadcast", {
    now: () => now,
    id: randomUUID,
    fingerprint: () => "fixture-version",
  });
  const followups = {
    pendingCount: 1,
    flush() {
      events.push("flush");
      this.pendingCount = 0;
    },
  };
  const ports = {
    participation,
    profile: () => profile,
    followups,
    rights: { list: () => [], videos: () => [] },
    notices: () => ({
      noticeBot: "ready",
      youtubeNoticeBot: "ready",
      chzzkNoticeBot: "ready",
    }),
    now: () => now,
  };
  const add = (platform = "soop", text = "Synthetic ordinary chat") => {
    participation.handle({
      platform,
      channel: "fixture",
      author: "viewer",
      text,
      sourceId: null,
    });
    return participation.get(platform, "fixture", "viewer")!;
  };
  return {
    administration: new ParticipationAdministration(ports),
    ports,
    participation,
    events,
    add,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("administrative status flushes durable followups and exposes only the reviewed participant projection", () => {
  const f = fixture(),
    person = f.add();
  person.requestIds.push("INTERNAL_PROVIDER_REQUEST");
  person.eventIds.add("INTERNAL_EVENT");
  const status = f.administration.status();
  assert.deepEqual(f.events, ["flush"]);
  assert.equal(status.pendingFollowups, 0);
  assert.equal(status.generatedAt, 100000);
  assert.equal(status.participants[0].account, "viewer");
  assert.match(status.participants[0].notice!.text, /!동의/);
  assert(!JSON.stringify(status).includes("INTERNAL_"));
  assert(!("accepted" in status.participants[0]));
  person.state = "ACTIVE";
  assert.equal(f.administration.status().participants[0].notice, null);
});
for (const platform of ["youtube", "chzzk", "soop"])
  test(
    platform + " manual notice confirmation cannot bypass provider delivery",
    () => {
      const f = fixture(),
        person = f.add(platform);
      assert.throws(
        () => f.administration.confirmNotice(person.id),
        /자동 발송/,
      );
      assert.equal(person.deliveredAt, null);
      assert.equal(person.state, "WAITING_CONSENT");
    },
  );
test("command confirmation requires the exact live observation and cannot be replayed", () => {
  const f = fixture(),
    person = f.add();
  f.participation.noticeDelivered("soop", "fixture", 100000, person.id);
  f.advance(1);
  f.add("soop", "!동의");
  const observation = f.participation.byId(person.id).observed!;
  assert(observation);
  assert.throws(() => f.administration.confirmCommand(person.id, randomUUID()));
  f.administration.confirmCommand(person.id, observation.id);
  assert.equal(f.participation.byId(person.id).state, "ACTIVE");
  assert.throws(() =>
    f.administration.confirmCommand(person.id, observation.id),
  );
  f.administration.blockAge(person.id);
  assert.equal(f.participation.byId(person.id).age, "blocked");
  assert.equal(f.participation.byId(person.id).state, "WITHDRAWN");
});
test("demo administration has an empty participant projection and rejects live controls", () => {
  const f = fixture();
  const administration = new ParticipationAdministration({
    ...f.ports,
    participation: undefined,
  });
  assert.deepEqual(administration.status().participants, []);
  assert.throws(() => administration.blockAge("absent"), /Live/);
});
test("HTTP command confirmation requires explicit verified-live evidence", async () => {
  const f = fixture(),
    person = f.add(),
    app = Fastify();
  registerParticipationRoutes(app, f.administration);
  try {
    const response = await app.inject("/api/admin/privacy");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().participants[0].id, person.id);
    const invalid = await app.inject({
      method: "POST",
      url:
        "/api/admin/privacy/participants/" +
        person.id +
        "/confirm-live-command",
      payload: { observationId: randomUUID(), verifiedLive: false },
    });
    assert(invalid.statusCode >= 400);
    assert.equal(f.participation.byId(person.id).state, "WAITING_CONSENT");
    const block = await app.inject({
      method: "POST",
      url: "/api/admin/privacy/participants/" + person.id + "/block-age",
    });
    assert.equal(block.statusCode, 200);
    assert.equal(f.participation.byId(person.id).age, "blocked");
  } finally {
    await app.close();
  }
});
