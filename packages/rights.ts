import { PrivacyActionError } from "./privacy-profile.ts";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
export const rightsIntakeSchema = z
  .object({
    contact: z.string().max(300).default(""),
    platform: z.string().trim().min(1).max(40),
    account: z.string().trim().min(1).max(256),
    session: z.string().trim().min(1).max(100),
    broadcaster: z.string().max(256).default(""),
    videoUrl: z.string().max(500).default(""),
    segment: z.string().max(100).default(""),
  })
  .strict();
export const rightsUpdateSchema = z
  .object({
    state: z.enum([
      "received",
      "verifying",
      "app_done",
      "external_pending",
      "completed",
      "limited",
    ]),
    appDone: z.boolean(),
    providerDone: z.boolean(),
    videoDone: z.boolean(),
    copiesDone: z.boolean(),
    outcome: z
      .enum([
        "pending",
        "masked",
        "muted",
        "segment_removed",
        "unpublished",
        "deleted",
        "no_identifiable_data",
        "provider_requested",
        "outside_control",
      ])
      .default("pending"),
  })
  .strict();
export class RightsQueue {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      `PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS rights_requests(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,platform TEXT NOT NULL,url TEXT NOT NULL,broadcast_at TEXT NOT NULL,status TEXT NOT NULL);`,
    );
  }
  create(
    raw: z.input<typeof rightsIntakeSchema>,
    requestIds: string[] = [],
    appDone = false,
  ) {
    const data = rightsIntakeSchema.parse(raw);
    const id = randomUUID();
    const row = {
      ...data,
      id,
      requestIds: [...new Set(requestIds)].slice(-100),
      state: appDone ? "external_pending" : "received",
      appDone,
      providerDone: false,
      videoDone: false,
      copiesDone: false,
      outcome: "pending",
      createdAt: Date.now(),
    };
    this.db
      .prepare("INSERT INTO rights_requests VALUES(?,?,?)")
      .run(id, JSON.stringify(row), row.createdAt);
    return row;
  }
  attachRequest(id: string, requestId: string) {
    const row = this.list().find((r) => r.id === id);
    if (row) {
      row.requestIds = [...new Set([...row.requestIds, requestId])].slice(-100);
      this.db
        .prepare("UPDATE rights_requests SET payload=? WHERE id=?")
        .run(JSON.stringify(row), id);
    }
  }
  list() {
    return this.db
      .prepare("SELECT payload FROM rights_requests ORDER BY created DESC")
      .all()
      .map((r: any) => JSON.parse(r.payload));
  }
  update(id: string, raw: unknown) {
    const patch = rightsUpdateSchema.parse(raw);
    const old = this.list().find((r) => r.id === id);
    if (!old) throw new PrivacyActionError("요청을 찾을 수 없습니다.");
    if (
      patch.state === "completed" &&
      (!patch.appDone ||
        !patch.providerDone ||
        !patch.videoDone ||
        !patch.copiesDone ||
        patch.outcome === "pending")
    )
      throw new PrivacyActionError(
        "앱·제공자·영상·사본 조치를 각각 확인해야 합니다.",
      );
    if (patch.state === "limited" && patch.outcome !== "outside_control")
      throw new PrivacyActionError("제한 사유를 확인해야 합니다.");
    const next = { ...old, ...patch };
    this.db
      .prepare("UPDATE rights_requests SET payload=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  remove(id: string) {
    const row = this.list().find((r) => r.id === id);
    if (!row || !["completed", "limited"].includes(row.state))
      throw new PrivacyActionError(
        "처리 결과 안내 후 불필요해진 요청 정보만 삭제할 수 있습니다.",
      );
    this.db.prepare("DELETE FROM rights_requests WHERE id=?").run(id);
  }
  video(raw: unknown) {
    const v = z
      .object({
        platform: z.enum(["soop", "chzzk", "youtube", "local"]),
        url: z.string().min(1).max(500),
        broadcastAt: z.string().min(1).max(80),
        status: z.enum(["public", "private", "removed", "local_copy"]),
      })
      .strict()
      .parse(raw);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO videos VALUES(?,?,?,?,?)")
      .run(id, v.platform, v.url, v.broadcastAt, v.status);
    return { id, ...v };
  }
  videos() {
    return this.db
      .prepare(
        "SELECT id,platform,url,broadcast_at AS broadcastAt,status FROM videos",
      )
      .all();
  }
  close() {
    this.db.close();
  }
}
