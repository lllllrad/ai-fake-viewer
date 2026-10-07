import { Button, Input, Select } from "../../components/ui";
import { useState } from "react";
import type { ParticipantStatus } from "../../../../../packages/contracts/participation.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";
import { participationApi } from "./api.ts";
import { platformName } from "./labels.ts";
const states = {
  UNCONSENTED: "미참여",
  WAITING_CONSENT: "동의 대기",
  ACTIVE: "참여 중",
  WITHDRAWN: "철회됨",
  ENDED: "종료",
};
export function Participants({
  participants,
  refresh,
  stale,
}: {
  participants: ParticipantStatus[];
  refresh: () => Promise<void>;
  stale: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = participants.filter(
    (person) =>
      `${person.account} ${platformName(person.platform)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (filter === "all" ||
        (filter === "active"
          ? person.state === "ACTIVE"
          : filter === "blocked"
            ? person.age === "blocked"
            : filter === "withdrawn"
              ? person.state === "WITHDRAWN"
              : !["ACTIVE", "WITHDRAWN", "ENDED"].includes(person.state))),
  );
  return (
    <section className="participation-section">
      <h2>참여 안내·현재 동의 상태 ({participants.length})</h2>
      <p>
        짧은 안내가 전달된 뒤 시청자가 새로 <strong>!동의</strong>를 입력하면
        참여합니다. 안내를 함께 볼 수 있던 시청자에게는 반복 발송하지 않지만,
        동의는 각자 받아야 합니다. 방송 채널 본인 계정은 제외합니다.
      </p>
      <p className="hint">
        연령은 자기신고이며 검증된 정보가 아닙니다. 만 14세 미만이거나 신고와
        모순되는 정보가 확인되면 참여를 차단하세요. SOOP 안내를 위해 관리자 탭의
        연결을 유지하세요.
      </p>
      {!participants.length && (
        <p className="empty-state">
          아직 참여 상태가 기록된 시청자가 없습니다.
        </p>
      )}
      <div className="filter-bar">
        <label>
          참여자 검색
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="계정 또는 플랫폼"
          />
        </label>
        <label>
          참여 상태
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">모든 상태</option>
            <option value="active">참여 중</option>
            <option value="waiting">동의 대기</option>
            <option value="blocked">참여 차단</option>
            <option value="withdrawn">철회됨</option>
          </Select>
        </label>
        <span role="status">{visible.length}명 표시</span>
      </div>
      {!!participants.length && !visible.length && (
        <p className="empty-state">검색 조건에 맞는 참여자가 없습니다.</p>
      )}
      <div className="participation-list">
        {visible.map((person) => (
          <Participant
            key={person.id}
            person={person}
            refresh={refresh}
            stale={stale}
          />
        ))}
      </div>
    </section>
  );
}
function Participant({
  person: p,
  refresh,
  stale,
}: {
  person: ParticipantStatus;
  refresh: () => Promise<void>;
  stale: boolean;
}) {
  const actions = useAdminActions(refresh);
  const [copyError, setCopyError] = useState("");
  const busy = stale || actions.busy(p.id);
  const automatic = ["soop", "youtube", "chzzk"].includes(p.platform);
  const observed = p.observed;
  return (
    <article className="participation-item">
      <h3>
        {platformName(p.platform)} · {p.account}
      </h3>
      <p>
        {states[p.state]} ·{" "}
        {p.state === "ACTIVE"
          ? "동의 완료"
          : p.deliveredAt
            ? "안내 전달됨"
            : "안내 대기"}{" "}
        ·{" "}
        {p.age === "blocked"
          ? "참여 차단"
          : p.age === "self_declared_14_plus"
            ? "14세 이상 자기신고 (검증 아님)"
            : "연령 미확인"}
      </p>
      {observed && (
        <p>
          수신 명령: {observed.command} ·{" "}
          {new Date(observed.receivedAt).toLocaleTimeString()}
        </p>
      )}
      {observed?.command === "!동의" && (
        <Button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "이 명령이 현재 연결에서 이용자가 새로 보낸 실제 !동의임을 확인했습니까? 과거 재전송은 확인하면 안 됩니다.",
              )
            )
              void actions.run(p.id, async (signal) => {
                await participationApi.participant(
                  p.id,
                  "confirm-live-command",
                  { observationId: observed.id, verifiedLive: true },
                  signal,
                );
              });
          }}
        >
          수신된 새 동의 명령 확인
        </Button>
      )}
      {p.notice && (
        <div className="participation-notice">
          <p>{p.notice.text}</p>
          <Button
            disabled={busy}
            onClick={() => {
              setCopyError("");
              void navigator.clipboard
                .writeText(p.notice!.text)
                .catch(() =>
                  setCopyError("안내문을 직접 선택해 복사해 주세요."),
                );
            }}
          >
            고정 안내문 복사
          </Button>
          {automatic ? (
            <p className="hint">자동 발송된 안내의 전달 확인을 기다립니다.</p>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "동의 안내문을 승인된 경로에서 실제 전달했고 실패하지 않았습니까?",
                  )
                )
                  void actions.run(p.id, async (signal) => {
                    await participationApi.participant(
                      p.id,
                      "notice-delivered",
                      { delivered: true },
                      signal,
                    );
                  });
              }}
            >
              안내 전달 완료 확인
            </Button>
          )}
        </div>
      )}
      {p.age !== "blocked" && (
        <Button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void actions.run(p.id, async (signal) => {
              await participationApi.participant(
                p.id,
                "block-age",
                undefined,
                signal,
              );
            })
          }
        >
          14세 미만·신고 모순으로 참여 차단
        </Button>
      )}
      {(actions.error || copyError) && (
        <p role="alert">{actions.error || copyError}</p>
      )}
    </article>
  );
}
