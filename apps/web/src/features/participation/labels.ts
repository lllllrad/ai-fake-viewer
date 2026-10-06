import type { RightsUpdate } from "../../../../../packages/contracts/rights.ts";
export const rightsStates: Record<RightsUpdate["state"], string> = {
  received: "접수",
  verifying: "대상 확인",
  app_done: "앱 조치 완료",
  external_pending: "외부·영상 조치 확인 중",
  completed: "완료",
  limited: "제한 사유 안내",
};
export const outcomes: Record<RightsUpdate["outcome"], string> = {
  pending: "확인 중",
  masked: "마스킹",
  muted: "음소거",
  segment_removed: "구간 삭제",
  unpublished: "비공개",
  deleted: "삭제",
  no_identifiable_data: "식별 가능한 정보 없음",
  provider_requested: "제공자 절차로 요청",
  outside_control: "직접 제어할 수 없는 기록 — 제한 안내",
};
export const videoStates = {
  public: "공개",
  private: "비공개",
  removed: "삭제됨",
  local_copy: "로컬 사본",
};
export const platforms = {
  youtube: "YouTube",
  chzzk: "치지직",
  soop: "SOOP",
  local: "로컬",
};
export function platformName(value: string) {
  return platforms[value as keyof typeof platforms] ?? value;
}
const notices: Record<string, string> = {
  ready: "정상",
  disabled: "사용 안 함",
  waiting_connection: "채팅 연결 필요",
  awaiting_echo: "전달 확인 중",
  sending: "안내 전달 중",
  auth_required: "계정 연결 필요",
  channel_mismatch: "방송 채널과 연결 계정이 다름",
  approval_required: "발송 승인·허용량 확인 필요",
  delivery_unconfirmed: "전달 미확인 · 발송 간격 이후 재시도",
  permission_or_quota_blocked:
    "안내 전송 API 요청 거절 · 연결 화면에서 권한·한도 확인",
  permission_blocked: "안내 전송 API 접근 권한 확인 필요",
  quota_blocked: "안내 전송 API 한도 도달 · 연결 화면에서 상세 확인",
  notice_too_long: "안내의 긴 주소·문구를 줄여 주세요",
};
export function noticeLabel(value: string) {
  return notices[value] ?? "상태 확인 필요";
}
