import React, { useEffect, useState } from "react";
const states: Record<string, string> = {
  UNCONSENTED: "미참여",
  WAITING_CONSENT: "단계별 동의 대기",
  ACTIVE: "참여 중",
  WITHDRAWN: "철회됨",
  ENDED: "종료",
  received: "접수",
  verifying: "대상 확인",
  app_done: "앱 조치 완료",
  external_pending: "외부·영상 조치 확인 중",
  completed: "완료",
  limited: "제한 사유 안내",
};
export function PrivacyPanel() {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [intake, setIntake] = useState({
    contact: "",
    platform: "soop",
    account: "",
    session: "",
    broadcaster: "",
    videoUrl: "",
    segment: "",
  });
  const [video, setVideo] = useState({
    platform: "soop",
    url: "",
    broadcastAt: "",
    status: "public",
  });
  const refresh = async () => {
    const r = await fetch("/api/admin/privacy");
    if (r.ok) setData(await r.json());
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, []);
  const action = async (path: string, body?: unknown, method = "POST") => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/privacy/${path}`, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) {
        const value = await r.json();
        throw Error(
          typeof value.error === "string"
            ? value.error
            : "처리 조건을 확인해 주세요.",
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  };
  if (!data) return null;
  return (
    <section
      id="privacy-panel"
      className="card privacy-panel"
      aria-label="개인정보 및 참여 관리"
    >
      <h2>개인정보·참여 관리</h2>
      <p>
        채팅·동의·AI 문맥은 현재 방송의 메모리에서만 처리하고 종료·재시작 시
        삭제합니다. 영상과 권리행사 후속 작업은 별도로 관리합니다.
      </p>
      {!!data.issues.length && (
        <p role="status">운영 프로필 확인 필요: {data.issues.join(" · ")}</p>
      )}
      {!!data.pendingFollowups && (
        <p role="alert">
          후속 작업 {data.pendingFollowups}건을 저장하지 못했습니다. 저장소를
          확인하고 이 화면에서 재시도 결과를 확인한 뒤 종료하세요.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>운영 프로필·공개 범위 확인</summary>
        <p>
          운영자: {data.profile.operator || "미설정"} / 담당자:{" "}
          {data.profile.officer || "미설정"} / 연락처:{" "}
          {data.profile.contact || "미설정"}
        </p>
        <p>
          방침: {data.profile.policyUrl || "미설정"} · 버전{" "}
          {data.profile.policyVersion || "미설정"}
        </p>
        <p>
          동의 안내: {data.profile.noticeUrl || "미설정"} · 버전{" "}
          {data.profile.noticeVersion || "미설정"}
        </p>
        <p>
          처리: OpenAI API · {data.profile.processing.model || "모델 미설정"} ·{" "}
          {data.profile.processing.countries.join(", ") || "국가 미확정"}
        </p>
        <p>
          제공자 보존: {data.profile.processing.retention || "미확정"} · 확인일{" "}
          {data.profile.processing.checkedAt || "미확정"}
        </p>
        <p>
          영상 공개:{" "}
          {data.profile.publications
            .map((p: any) => `${p.platform} ${p.channel} (${p.retention})`)
            .join(" · ") || "미확정"}
        </p>
        <p className="hint">
          운영 프로필은 config.yaml의 privacy에서 설정합니다. 실제 계약·안내
          내용을 확인한 뒤 적용하세요. 영상·음성, ChatGPT 구독·다른 AI 제공자
          경로는 이 프로필에서 사용하지 않습니다.
        </p>
      </details>
      <details>
        <summary>참여 안내·현재 동의 상태 ({data.participants.length})</summary>
        <p className="hint">
          고정 안내는 승인된 플랫폼 경로에서 직접 전달합니다. 아래 확인은 실제
          전달·실제 명령의 확인이며 참여자를 대신한 동의가 아닙니다. 만 14세
          미만 또는 확인할 수 없는 경우 차단하세요.
        </p>
        {data.participants.map((p: any) => (
          <article key={p.id} className="persona-candidate">
            <h3>
              {p.platform} · {p.account}
            </h3>
            <p>
              {states[p.state]} · 단계 {p.stage + 1} · 연령{" "}
              {p.age === "confirmed"
                ? "14세 이상 확인"
                : p.age === "blocked"
                  ? "참여 차단"
                  : "미확인"}
            </p>
            {p.observed && (
              <p>
                수신 명령: {p.observed.command} ·{" "}
                {new Date(p.observed.receivedAt).toLocaleTimeString()}
              </p>
            )}
            {p.observed?.command === "!동의" && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "이 명령이 현재 연결에서 이용자가 새로 보낸 실제 !동의임을 확인했습니까? 과거 재전송은 확인하면 안 됩니다.",
                    )
                  )
                    void action(`participants/${p.id}/confirm-live-command`, {
                      observationId: p.observed.id,
                      verifiedLive: true,
                    });
                }}
              >
                수신된 새 동의 명령 확인
              </button>
            )}
            {p.notice && (
              <>
                <p>{p.notice.text}</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(p.notice.text)
                      .catch(() =>
                        setError("안내문을 직접 선택해 복사해 주세요."),
                      )
                  }
                >
                  고정 안내문 복사
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "현재 단계의 안내문을 승인된 경로에서 실제 전달했고 실패하지 않았습니까?",
                      )
                    )
                      void action(`participants/${p.id}/notice-delivered`, {
                        delivered: true,
                      });
                  }}
                >
                  안내 전달 완료 확인
                </button>
              </>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void action(`participants/${p.id}/block-age`)}
            >
              연령 미달·확인 불가로 참여 차단
            </button>
          </article>
        ))}
      </details>
      <details>
        <summary>
          권리행사·영상 후속 조치 (
          {
            data.rights.filter(
              (r: any) => !["completed", "limited"].includes(r.state),
            ).length
          }
          )
        </summary>
        <p>
          앱에서 삭제해도 이미 보낸 외부 요청·공개 영상·로컬 원본·재업로드
          사본의 조치는 별도로 확인합니다. 이 화면에는 채팅 원문이나 신분증을
          입력하지 마세요.
        </p>
        {data.rights.map((r: any) => (
          <RightsItem
            key={r.id}
            row={r}
            busy={busy}
            save={(patch) => action(`rights/${r.id}`, patch, "PATCH")}
            remove={() => action(`rights/${r.id}`, undefined, "DELETE")}
          />
        ))}
        <h3>방송 종료 후 요청 접수</h3>
        {Object.entries({
          contact: "회신 연락처 (선택)",
          platform: "플랫폼",
          account: "대상 계정",
          session: "방송 세션",
          broadcaster: "방송 채널",
          videoUrl: "영상 주소 (선택)",
          segment: "영상 구간 (선택)",
        }).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={(intake as any)[key]}
              onChange={(e) => setIntake({ ...intake, [key]: e.target.value })}
            />
          </label>
        ))}
        <button
          disabled={busy || !intake.account || !intake.session}
          onClick={() => void action("rights", intake)}
        >
          요청 접수
        </button>
      </details>
      <details>
        <summary>영상·사본 목록</summary>
        {data.videos.map((v: any) => (
          <p key={v.id}>
            {v.platform} · {v.url} · {v.broadcastAt} · {v.status}
          </p>
        ))}
        <label>
          플랫폼
          <select
            value={video.platform}
            onChange={(e) => setVideo({ ...video, platform: e.target.value })}
          >
            {["soop", "chzzk", "youtube", "local"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          영상 주소 또는 사본 위치
          <input
            value={video.url}
            onChange={(e) => setVideo({ ...video, url: e.target.value })}
          />
        </label>
        <label>
          방송 시각
          <input
            value={video.broadcastAt}
            onChange={(e) =>
              setVideo({ ...video, broadcastAt: e.target.value })
            }
          />
        </label>
        <label>
          공개 상태
          <select
            value={video.status}
            onChange={(e) => setVideo({ ...video, status: e.target.value })}
          >
            {["public", "private", "removed", "local_copy"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !video.url || !video.broadcastAt}
          onClick={() => void action("videos", video)}
        >
          영상 목록에 추가
        </button>
      </details>
    </section>
  );
}
function RightsItem({
  row,
  busy,
  save,
  remove,
}: {
  row: any;
  busy: boolean;
  save: (p: any) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [patch, setPatch] = useState({
    state: row.state,
    appDone: row.appDone,
    providerDone: row.providerDone,
    videoDone: row.videoDone,
    copiesDone: row.copiesDone,
    outcome: row.outcome,
  });
  return (
    <article className="persona-candidate">
      <h3>
        {row.platform} · {row.account} · {states[row.state]}
      </h3>
      <p>
        세션 {row.session} · 영상 {row.videoUrl || "확인 필요"} · 구간{" "}
        {row.segment || "확인 필요"}
      </p>
      <p>
        회신 {row.contact || "플랫폼 요청으로 접수"} · 외부 요청 식별자{" "}
        {row.requestIds.join(", ") || "확인 필요"}
      </p>
      {Object.entries({
        appDone: "앱 조치 확인",
        providerDone: "외부 제공자 조치 확인",
        videoDone: "공개 영상 조치 확인",
        copiesDone: "원본·편집본·재업로드 사본 조치 확인",
      }).map(([k, label]) => (
        <label key={k} className="privacy-check">
          <input
            type="checkbox"
            checked={(patch as any)[k]}
            onChange={(e) => setPatch({ ...patch, [k]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        진행 상태
        <select
          value={patch.state}
          onChange={(e) => setPatch({ ...patch, state: e.target.value })}
        >
          {[
            "received",
            "verifying",
            "app_done",
            "external_pending",
            "completed",
            "limited",
          ].map((s) => (
            <option key={s} value={s}>
              {states[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        조치 결과
        <select
          value={patch.outcome}
          onChange={(e) => setPatch({ ...patch, outcome: e.target.value })}
        >
          {Object.entries({
            pending: "확인 중",
            masked: "마스킹",
            muted: "음소거",
            segment_removed: "구간 삭제",
            unpublished: "비공개",
            deleted: "삭제",
            no_identifiable_data: "식별 가능한 정보 없음",
            provider_requested: "제공자 절차로 요청",
            outside_control: "직접 제어할 수 없는 기록 — 제한 안내",
          }).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => void save(patch)}>
        처리 상태 저장
      </button>
      {["completed", "limited"].includes(row.state) && (
        <button disabled={busy} onClick={() => void remove()}>
          불필요해진 요청 정보 삭제
        </button>
      )}
    </article>
  );
}
