import type { ApiFailure } from "./contracts/api-failure.ts";
export type { ApiFailure } from "./contracts/api-failure.ts";
export class ApiQuotaError extends Error {
  constructor(public api: string) {
    super("quota_blocked");
  }
}
export function limitState(status: number, reason = "") {
  if (status === 429 || /quota|rateLimit/i.test(reason)) return "quota_blocked";
  if (status === 401) return "auth_required";
  if (status === 403)
    return reason ? "permission_blocked" : "permission_or_quota_blocked";
  return "delivery_unconfirmed";
}
export function apiIssues(input: {
  youtubeRead: { state: string; api?: string };
  chzzkRead?: { state: string; api?: string };
  youtubeSend: { state: string; failure?: ApiFailure };
  chzzkSend: { state: string; failure?: ApiFailure };
  audioState: string;
  audioProvider?: "groq" | "openai";
  modelState: string;
  modelIssue?: { code: string };
}) {
  const issues: Array<{ api: string; operation: string; message: string }> = [];
  if (input.chzzkRead?.state === "quota_blocked")
    issues.push({
      api: input.chzzkRead.api ?? "CHZZK Session API",
      operation: "채팅 수신 연결",
      message:
        "채팅 수신 연결 API 한도에 도달했습니다. 채팅 전송 API의 한도 도달 여부는 별도로 확인해야 합니다.",
    });
  if (input.youtubeRead.state === "quota_blocked")
    issues.push({
      api: input.youtubeRead.api ?? "YouTube Data API",
      operation: "조회·수신",
      message:
        "조회·수신 API 한도에 도달했습니다. 안내 전송도 수신 연결을 기다립니다. 전송 API 자체의 한도 도달 여부는 아직 확인되지 않았습니다.",
    });
  for (const [platform, sender] of [
    ["YouTube", input.youtubeSend],
    ["CHZZK", input.chzzkSend],
  ] as const) {
    const state = sender.failure?.state ?? sender.state;
    if (
      ![
        "quota_blocked",
        "permission_or_quota_blocked",
        "permission_blocked",
      ].includes(state)
    )
      continue;
    const operation =
      sender.failure?.operation === "identity" ? "발송 계정 조회" : "채팅 전송";
    issues.push({
      api: sender.failure?.api ?? `${platform} Chat API`,
      operation,
      message:
        state === "quota_blocked"
          ? `${operation} API 한도에 도달했습니다.`
          : state === "permission_blocked"
            ? `${operation} API 접근 권한이 없습니다.`
            : `${operation} API가 거절되었습니다. 권한 문제인지 한도 문제인지는 응답에서 구분되지 않았습니다.`,
    });
  }
  if (input.audioState === "budget_exhausted")
    issues.push({
      api:
        input.audioProvider === "openai"
          ? "OpenAI Audio Transcriptions"
          : "Groq Audio Transcriptions",
      operation: "음성 인식",
      message:
        "앱에 설정한 전사 호출 횟수 한도(audio.maxRequests)에 도달했습니다. 채팅 조회·전송 한도와 별개입니다.",
    });
  if (input.audioState === "quota_blocked")
    issues.push({
      api:
        input.audioProvider === "openai"
          ? "OpenAI Audio Transcriptions"
          : "Groq Audio Transcriptions",
      operation: "음성 인식",
      message: "음성 인식 API가 사용 한도(HTTP 429)로 요청을 거절했습니다.",
    });
  const code = input.modelIssue?.code;
  if (input.modelState === "budget_exhausted")
    issues.push({
      api: "OpenAI Responses API",
      operation: "AI 생성·검수",
      message:
        "앱에 설정한 AI 호출·비용 한도에 도달했습니다. 플랫폼 채팅 조회·전송 한도와 별개입니다.",
    });
  else if (code === "provider_http_429")
    issues.push({
      api: "OpenAI Responses API",
      operation: "AI 생성·검수",
      message: "AI API가 사용 한도(HTTP 429)로 요청을 거절했습니다.",
    });
  else if (code === "input_token_limit" || code === "output_token_limit")
    issues.push({
      api: "OpenAI Responses API",
      operation: "AI 생성·검수",
      message: `앱에 설정한 ${code === "input_token_limit" ? "입력" : "출력"} 토큰 한도에 도달했습니다.`,
    });
  return issues;
}
