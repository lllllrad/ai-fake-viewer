import {
  rightsIntakeSchema,
  rightsUpdateSchema,
  videoIntakeSchema,
  type RightsIntake,
  type RightsRecord,
} from "../../contracts/rights.ts";
import {
  resolutionProblem,
  canRemoveRightsRecord,
} from "../../domain/rights/resolution.ts";
import type { RightsRepository, RightsRuntime } from "./ports.ts";
export class RightsActionError extends Error {
  statusCode = 400;
}
export class RightsService {
  constructor(
    private readonly repository: RightsRepository,
    private readonly runtime: RightsRuntime,
  ) {}
  create(
    raw: RightsIntake,
    requestIds: string[] = [],
    appDone = false,
  ): RightsRecord {
    const data = rightsIntakeSchema.parse(raw);
    const record: RightsRecord = {
      ...data,
      id: this.runtime.id(),
      requestIds: [...new Set(requestIds)].slice(-100),
      state: appDone ? "external_pending" : "received",
      appDone,
      providerDone: false,
      videoDone: false,
      copiesDone: false,
      outcome: "pending",
      createdAt: this.runtime.now(),
    };
    this.repository.insert(record);
    return record;
  }
  createFollowup(
    id: string,
    raw: RightsIntake,
    requestIds: string[],
  ): { id: string } {
    return this.repository.transaction(() => {
      const existing = this.repository.find(id);
      if (existing) {
        this.repository.save({
          ...existing,
          requestIds: [
            ...new Set([...existing.requestIds, ...requestIds]),
          ].slice(-100),
        });
      } else if (!this.repository.receivedFollowup(id)) {
        const data = rightsIntakeSchema.parse(raw);
        this.repository.insert({
          ...data,
          id,
          requestIds: [...new Set(requestIds)].slice(-100),
          state: "external_pending",
          appDone: true,
          providerDone: false,
          videoDone: false,
          copiesDone: false,
          outcome: "pending",
          createdAt: this.runtime.now(),
        });
      }
      this.repository.acknowledgeFollowup(id);
      return { id };
    });
  }
  attachRequest(id: string, requestId: string) {
    this.repository.transaction(() => {
      const record = this.repository.find(id);
      if (!record) return;
      this.repository.save({
        ...record,
        requestIds: [...new Set([...record.requestIds, requestId])].slice(-100),
      });
    });
  }
  list() {
    return this.repository.list();
  }
  update(id: string, raw: unknown) {
    const patch = rightsUpdateSchema.parse(raw);
    return this.repository.transaction(() => {
      const record = this.repository.find(id);
      if (!record) throw new RightsActionError("요청을 찾을 수 없습니다.");
      const problem = resolutionProblem(patch);
      if (problem)
        throw new RightsActionError(
          problem === "actions_incomplete"
            ? "앱·제공자·영상·사본 조치를 각각 확인해야 합니다."
            : "제한 사유를 확인해야 합니다.",
        );
      const next = { ...record, ...patch };
      this.repository.save(next);
      return next;
    });
  }
  remove(id: string) {
    this.repository.transaction(() => {
      const record = this.repository.find(id);
      if (!record || !canRemoveRightsRecord(record.state))
        throw new RightsActionError(
          "처리 결과 안내 후 불필요해진 요청 정보만 삭제할 수 있습니다.",
        );
      this.repository.remove(id);
    });
  }
  video(raw: unknown) {
    const data = videoIntakeSchema.parse(raw),
      record = { id: this.runtime.id(), ...data };
    this.repository.addVideo(record);
    return record;
  }
  videos() {
    return this.repository.videos();
  }
  close() {
    this.repository.close();
  }
}
