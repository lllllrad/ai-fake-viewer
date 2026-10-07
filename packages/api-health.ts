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
  audioState: string;
  audioProvider?: "groq" | "openai";
  modelState: string;
  modelIssue?: { code: string };
}) {
  const issues: Array<{ api: string; operation: string; message: string }> = [];
  if (input.audioState === "budget_exhausted")
    issues.push({
      api:
        input.audioProvider === "openai"
          ? "OpenAI Audio Transcriptions"
          : "Groq Audio Transcriptions",
      operation: "음성 인식",
      message:
        "앱에 설정한 전사 호출 횟수 한도(audio.maxRequests)에 도달했습니다.",
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
      message: "앱에 설정한 AI 비용 한도에 도달했습니다. 플랫폼",
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
