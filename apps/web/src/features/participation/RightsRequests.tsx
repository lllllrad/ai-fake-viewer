import { Button, Input, Select } from "../../components/ui";
import { useState } from "react";
import {
  rightsUpdateSchema,
  type RightsIntake,
  type RightsRecord,
  type RightsUpdate,
} from "../../../../../packages/contracts/rights.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";
import { participationApi } from "./api.ts";
import { rightsStates, outcomes, platformName } from "./labels.ts";
type Props = { refresh: () => Promise<void>; stale: boolean };
const fields = {
  contact: "회신 연락처 (선택)",
  platform: "플랫폼",
  account: "대상 계정",
  session: "방송 세션",
  broadcaster: "방송 채널",
  videoUrl: "영상 주소 (선택)",
  segment: "영상 구간 (선택)",
};
export function RightsRequests({
  rows,
  ...props
}: Props & { rows: RightsRecord[] }) {
  return (
    <section className="participation-section">
      <h2>
        권리행사·영상 후속 조치 (
        {rows.filter((r) => !["completed", "limited"].includes(r.state)).length}
        )
      </h2>
      <p>
        앱 삭제와 외부 제공자·공개 영상·사본의 조치는 각각 확인합니다. 이 화면에
        채팅 원문이나 신분증을 입력하지 마세요.
      </p>
      {!rows.length && (
        <p className="empty-state">접수된 권리행사 요청이 없습니다.</p>
      )}
      <div className="participation-list">
        {rows.map((row) => (
          <RightsItem key={row.id} row={row} {...props} />
        ))}
      </div>
      <RightsIntakeForm {...props} />
    </section>
  );
}
function RightsIntakeForm({ refresh, stale }: Props) {
  const [value, setValue] = useState<RightsIntake>({
    contact: "",
    platform: "soop",
    account: "",
    session: "",
    broadcaster: "",
    videoUrl: "",
    segment: "",
  });
  const actions = useAdminActions(refresh);
  return (
    <form
      className="participation-form"
      onSubmit={(e) => {
        e.preventDefault();
        void actions.run("intake", async (signal) => {
          await participationApi.createRights(value, signal);
        });
      }}
    >
      <h3>방송 종료 후 요청 접수</h3>
      <div className="participation-fields">
        {(Object.keys(fields) as (keyof typeof fields)[]).map((key) => (
          <label key={key}>
            {fields[key]}
            <Input
              required={["platform", "account", "session"].includes(key)}
              value={value[key] ?? ""}
              maxLength={
                key === "contact"
                  ? 300
                  : key === "videoUrl"
                    ? 500
                    : key === "platform"
                      ? 40
                      : key === "session" || key === "segment"
                        ? 100
                        : 256
              }
              onChange={(e) => setValue({ ...value, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <Button
        disabled={
          stale ||
          actions.busy("intake") ||
          !value.account.trim() ||
          !value.session.trim()
        }
      >
        요청 접수
      </Button>
      {actions.error && <p role="alert">{actions.error}</p>}
    </form>
  );
}
const checks = {
  appDone: "앱 조치 확인",
  providerDone: "외부 제공자 조치 확인",
  videoDone: "공개 영상 조치 확인",
  copiesDone: "원본·편집본·재업로드 사본 조치 확인",
};
function currentPatch(row: RightsRecord): RightsUpdate {
  return {
    state: row.state,
    appDone: row.appDone,
    providerDone: row.providerDone,
    videoDone: row.videoDone,
    copiesDone: row.copiesDone,
    outcome: row.outcome,
  };
}
function RightsItem({ row, refresh, stale }: Props & { row: RightsRecord }) {
  // Polling updates untouched rows but never overwrites an operator's unfinished edits.
  const [draft, setDraft] = useState<RightsUpdate>();
  const patch = draft ?? currentPatch(row);
  const actions = useAdminActions(refresh);
  const busy = stale || actions.busy(row.id);
  return (
    <article className="participation-item">
      <h3>
        {platformName(row.platform)} · {row.account} · {rightsStates[row.state]}
      </h3>
      <p>
        세션 {row.session} · 영상 {row.videoUrl || "확인 필요"} · 구간{" "}
        {row.segment || "확인 필요"}
      </p>
      <p>
        회신 {row.contact || "플랫폼 요청으로 접수"} · 외부 요청 식별자{" "}
        {row.requestIds.join(", ") || "확인 필요"}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void actions.run(row.id, async (signal) => {
            await participationApi.updateRights(row.id, patch, signal);
            if (!signal.aborted) setDraft(undefined);
          });
        }}
      >
        <fieldset disabled={busy}>
          <legend>조치 확인 및 처리 결과</legend>
          {(Object.keys(checks) as (keyof typeof checks)[]).map((key) => (
            <label key={key} className="participation-check">
              <Input
                type="checkbox"
                checked={patch[key]}
                onChange={(e) =>
                  setDraft({ ...patch, [key]: e.target.checked })
                }
              />
              {checks[key]}
            </label>
          ))}
          <div className="participation-fields">
            <label>
              진행 상태
              <Select
                value={patch.state}
                onChange={(e) =>
                  setDraft({
                    ...patch,
                    state: rightsUpdateSchema.shape.state.parse(e.target.value),
                  })
                }
              >
                {Object.entries(rightsStates).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              조치 결과
              <Select
                value={patch.outcome}
                onChange={(e) =>
                  setDraft({
                    ...patch,
                    outcome: rightsUpdateSchema.shape.outcome.parse(
                      e.target.value,
                    ),
                  })
                }
              >
                {Object.entries(outcomes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <Button>처리 상태 저장</Button>
          {draft && (
            <Button
              type="button"
              className="secondary"
              onClick={() => setDraft(undefined)}
            >
              편집 취소
            </Button>
          )}
        </fieldset>
      </form>
      {["completed", "limited"].includes(row.state) && (
        <Button
          disabled={busy}
          className="secondary"
          onClick={() => {
            if (
              window.confirm(
                "처리 결과를 안내했고 더 이상 필요하지 않은 요청 정보입니까? 삭제하면 되돌릴 수 없습니다.",
              )
            )
              void actions.run(row.id, async (signal) => {
                await participationApi.removeRights(row.id, signal);
              });
          }}
        >
          불필요해진 요청 정보 삭제
        </Button>
      )}
      {actions.error && <p role="alert">{actions.error}</p>}
    </article>
  );
}
