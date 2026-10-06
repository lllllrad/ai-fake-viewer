import { useEffect, useState, useSyncExternalStore } from "react";
import { StatusSession } from "../workspace/status-session.ts";
import { participationApi } from "./api.ts";
import { Participants } from "./Participants.tsx";
import { OperatingProfile } from "./OperatingProfile.tsx";
import { RightsRequests } from "./RightsRequests.tsx";
import { VideoInventory } from "./VideoInventory.tsx";
import { noticeLabel } from "./labels.ts";
import "./participation.css";
export function ParticipationPage({ now }: { now: number }) {
  const [owner] = useState(
    () => new StatusSession(participationApi.status, 5000),
  );
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  useEffect(() => {
    owner.start();
    return () => owner.stop();
  }, [owner]);
  const data = state.data;
  const stale = state.failed || !!(data && now - data.generatedAt > 10000);
  return (
    <section
      id="privacy-panel"
      className="participation-page"
      aria-label="개인정보 및 참여 관리"
    >
      <header className="participation-heading">
        <div>
          <h2>개인정보·참여 관리</h2>
          <p>
            채팅·동의·AI 문맥은 재시작 후 복구하며 방송 종료 시 삭제합니다.
            권리행사 후속 작업은 별도로 보존합니다.
          </p>
        </div>
        <button className="secondary" onClick={() => void owner.refresh()}>
          상태 다시 확인
        </button>
      </header>
      {stale && (
        <p role="alert">
          {state.error || "참여 상태 갱신이 지연되고 있습니다."}{" "}
          {data
            ? "마지막 확인 결과입니다. 다시 확인하기 전에는 변경할 수 없습니다."
            : ""}
        </p>
      )}
      {state.phase === "signed_out" && (
        <p role="alert">관리자 인증이 만료되었습니다. 다시 로그인해 주세요.</p>
      )}
      {!data && state.phase === "checking" && (
        <p role="status">참여 상태를 확인하고 있습니다.</p>
      )}
      {data && (
        <>
          {!!data.pendingFollowups && (
            <p role="alert">
              후속 작업 {data.pendingFollowups}건을 저장하지 못했습니다.
              저장소를 확인하고 재시도 결과를 확인한 뒤 종료하세요.
            </p>
          )}
          <section aria-label="자동 안내 상태" className="participation-health">
            {[
              ["SOOP", data.noticeBot],
              ["YouTube", data.youtubeNoticeBot],
              ["치지직", data.chzzkNoticeBot],
            ].map(([name, value]) => (
              <p key={name}>
                <strong>{name} 자동 안내</strong>
                <span>{stale ? "확인 필요" : noticeLabel(value)}</span>
              </p>
            ))}
          </section>
          <Participants
            participants={data.participants}
            refresh={owner.refresh}
            stale={stale}
          />
          <RightsRequests
            rows={data.rights}
            refresh={owner.refresh}
            stale={stale}
          />
          <VideoInventory
            rows={data.videos}
            refresh={owner.refresh}
            stale={stale}
          />
          <OperatingProfile profile={data.profile} issues={data.issues} />
        </>
      )}
    </section>
  );
}
