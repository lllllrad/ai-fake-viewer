import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RightsService,
  RightsActionError,
} from "../packages/application/rights/service.ts";
import { SqliteRightsRepository } from "../packages/infrastructure/rights/sqlite.ts";
import { resolutionProblem } from "../packages/domain/rights/resolution.ts";

const intake = {
  platform: "youtube",
  account: "fixture-viewer",
  session: "fixture-session",
};
const complete = {
  state: "completed",
  appDone: true,
  providerDone: true,
  videoDone: true,
  copiesDone: true,
  outcome: "deleted",
};

test("rights completion checks every action and a concrete outcome", () => {
  assert.equal(resolutionProblem(complete), undefined);
  for (const flag of ["appDone", "providerDone", "videoDone", "copiesDone"]) {
    assert.equal(
      resolutionProblem({ ...complete, [flag]: false }),
      "actions_incomplete",
    );
  }
  assert.equal(
    resolutionProblem({ ...complete, outcome: "pending" }),
    "actions_incomplete",
  );
  assert.equal(
    resolutionProblem({ ...complete, state: "limited" }),
    "limitation_missing",
  );
  assert.equal(
    resolutionProblem({
      ...complete,
      state: "limited",
      outcome: "outside_control",
    }),
    undefined,
  );
});

test("rights references stay distinct and bounded; failed resolution leaves intake intact", () => {
  const repository = new SqliteRightsRepository(":memory:");
  let sequence = 0;
  const service = new RightsService(repository, {
    id: () => String(++sequence),
    now: () => 42,
  });
  try {
    const task = service.create(
      intake,
      Array.from({ length: 110 }, (_, i) => String(i)),
      true,
    );
    assert.equal(task.createdAt, 42);
    assert.equal(task.state, "external_pending");
    assert.equal(task.requestIds.length, 100);
    assert.equal(task.requestIds[0], "10");
    service.attachRequest(task.id, "109");
    service.attachRequest(task.id, "110");
    assert.deepEqual(
      service.list()[0].requestIds,
      Array.from({ length: 100 }, (_, i) => String(i + 11)),
    );
    const before = service.list();
    assert.throws(
      () => service.update(task.id, { ...complete, copiesDone: false }),
      RightsActionError,
    );
    assert.throws(() => service.remove(task.id), RightsActionError);
    assert.deepEqual(service.list(), before);
    service.update(task.id, {
      ...complete,
      state: "limited",
      outcome: "outside_control",
    });
    service.remove(task.id);
    assert.deepEqual(service.list(), []);
    service.attachRequest("missing", "request");
    assert.throws(() => service.update("missing", complete), RightsActionError);
  } finally {
    service.close();
  }
});

test("SQLite rights writes roll back together and a failed transaction does not poison the next", () => {
  const repository = new SqliteRightsRepository(":memory:");
  const service = new RightsService(repository, {
    id: () => "fixture",
    now: () => 42,
  });
  try {
    const task = service.create(intake);
    assert.throws(
      () =>
        repository.transaction(() => {
          repository.save({ ...task, contact: "changed" });
          repository.addVideo({
            id: "video",
            platform: "local",
            url: "fixture",
            broadcastAt: "fixture",
            status: "local_copy",
          });
          throw new Error("synthetic storage workflow failure");
        }),
      /synthetic storage/,
    );
    assert.equal(repository.find(task.id)?.contact, "");
    assert.deepEqual(repository.videos(), []);
    service.update(task.id, complete);
    assert.equal(repository.find(task.id)?.state, "completed");
  } finally {
    service.close();
  }
});

test("rights adapter opens the previous database format without replacing durable records", () => {
  const directory = mkdtempSync(join(tmpdir(), "rights-compatibility-"));
  const path = join(directory, "rights.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE rights_requests(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE videos(id TEXT PRIMARY KEY,platform TEXT NOT NULL,url TEXT NOT NULL,broadcast_at TEXT NOT NULL,status TEXT NOT NULL);",
    );
    const legacy = {
      ...intake,
      contact: "",
      broadcaster: "",
      videoUrl: "",
      segment: "",
      id: "old",
      requestIds: ["provider-request"],
      state: "received",
      appDone: false,
      providerDone: false,
      videoDone: false,
      copiesDone: false,
      outcome: "pending",
      createdAt: 1,
    };
    db.prepare("INSERT INTO rights_requests VALUES(?,?,?)").run(
      "old",
      JSON.stringify(legacy),
      1,
    );
    db.prepare("INSERT INTO videos VALUES(?,?,?,?,?)").run(
      "old-video",
      "youtube",
      "fixture",
      "fixture",
      "public",
    );
    db.close();
    const repository = new SqliteRightsRepository(path);
    try {
      assert.deepEqual(repository.list(), [legacy]);
      assert.equal(repository.videos()[0].id, "old-video");
      assert.equal(statSync(path).mode & 0o777, 0o600);
    } finally {
      repository.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
