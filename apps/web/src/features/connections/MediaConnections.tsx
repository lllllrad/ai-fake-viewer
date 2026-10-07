import { Button } from "../../components/ui";
import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import { inputHealth } from "../../input-health.ts";
import { connectionApi } from "./api.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";
export function MediaConnections({
  status,
  preview,
  stale,
  refresh,
}: {
  status: AdminStatus;
  preview: string;
  stale: boolean;
  refresh: () => Promise<void>;
}) {
  const actions = useAdminActions(refresh),
    audio = inputHealth(status.audio.state, "transcription");
  const fresh =
    !stale &&
    status.capture.lastFrameAgeMs !== null &&
    status.capture.lastFrameAgeMs <= 10000;
  return (
    <section className="connection-group" aria-label="영상과 음성 입력">
      <h2>AI 전용 스트림</h2>
      <p className="hint">
        시청자 채팅·후원 알림을 제외한 화면과 마이크 음성만 포함된 별도 스트림을
        사용하세요.
      </p>
      {
        <p>
          config.yaml의 input.streamUrl에 AI 전용 RTMP/RTMPS 재생 주소를
          설정하세요. 화면과 음성은 같은 주소에서 수신하며, 방송 전체 스트림으로
          자동 전환하지 않습니다.
        </p>
      }
      {actions.error && (
        <p role="alert" className="error">
          {actions.error}
        </p>
      )}
      <div className="connection-grid media-connections">
        <section className="card" id="program-details">
          <div className="section-title">
            <h3>AI용 화면 입력</h3>
            <span className="status">
              {stale ? "확인 불가" : fresh ? "정상" : "확인 필요"}
            </span>
          </div>
          <div className="preview">
            {fresh && preview ? (
              <img src={preview} alt="AI가 보는 전용 스트림 화면" />
            ) : (
              <p>최근 송출 화면을 기다리고 있습니다.</p>
            )}
          </div>
          <p>
            {status.capture.backend === "rtmp"
              ? "OBS에서 설정된 주소로 송출을 시작하세요."
              : "OBS 가상 카메라를 Program 출력으로 시작하세요."}
          </p>
          {status.capture.lastError && !stale && (
            <p role="status">{status.capture.lastError}</p>
          )}
          <div className="toolbar">
            <Button
              disabled={stale || status.closed || actions.busy("capture")}
              onClick={() =>
                void actions.run("capture", (signal) =>
                  connectionApi.command("capture/start", signal),
                )
              }
            >
              화면 수신 시작
            </Button>
            <Button
              className="secondary"
              disabled={actions.busy("capture")}
              onClick={() =>
                void actions.run("capture", (signal) =>
                  connectionApi.command("capture/stop", signal),
                )
              }
            >
              화면 수신 중지
            </Button>
          </div>
          <details>
            <summary>영상 설정 상세</summary>
            <p>
              입력 방식: {status.capture.backend} ·{" "}
              {status.capture.dimensions || "해상도 확인 중"}
            </p>
            <p>최근 1분 {status.capture.framesInLastMinute}프레임</p>
            {status.capture.device && <p>장치: {status.capture.device}</p>}
          </details>
        </section>
        <section className="card" id="audio-details">
          <div className="section-title">
            <h3>
              음성 전사 ·{" "}
              {status.audio.provider === "openai" ? "OpenAI Whisper" : "Groq"}
            </h3>
            <span className="status">{stale ? "확인 불가" : audio.label}</span>
          </div>
          {!stale && audio.hint && <p>{audio.hint}</p>}
          <p>
            {stale
              ? "최근 입력 상태를 확인해 주세요."
              : status.audio.latestText || "인식된 음성을 기다리고 있습니다."}
          </p>
          <p className="hint">
            AI 전용 스트림의 마이크 음성을 전사합니다. 마이크에 들어온 소리는
            모두 포함될 수 있습니다. config.yaml의 input.streamUrl과
            audio.provider,
            {status.audio.provider === "openai"
              ? "OPENAI_API_KEY"
              : "GROQ_API_KEY"}
            를 설정하세요.
          </p>
          <div className="toolbar">
            <Button
              disabled={stale || status.closed || actions.busy("audio")}
              onClick={() =>
                void actions.run("audio", (signal) =>
                  connectionApi.command("audio/start", signal),
                )
              }
            >
              음성 전사 시작
            </Button>
            <Button
              className="secondary"
              disabled={actions.busy("audio")}
              onClick={() =>
                void actions.run("audio", (signal) =>
                  connectionApi.command("audio/stop", signal),
                )
              }
            >
              음성 전사 중지
            </Button>
            <a
              href="/api/admin/transcripts/export"
              download="transcripts.jsonl"
            >
              전사문 내보내기
            </a>
          </div>
          <details>
            <summary>전사 사용량·설정</summary>
            <p>
              현재 방송 호출 {status.audio.requests} /{" "}
              {status.audio.maxRequests}회
            </p>
            <p>
              언어: {status.audio.language} · 저장된 청크{" "}
              {status.audio.loggedCount}개
            </p>
            <p>
              기록은 서버 재시작 후 복구하고 방송 종료 시 삭제합니다. 내보낸
              파일은 별도로 관리하세요.
            </p>
          </details>
        </section>
      </div>
    </section>
  );
}
