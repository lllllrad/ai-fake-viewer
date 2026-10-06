export interface GenerationIssue {
  code: string;
  message: string;
  retryable: boolean;
  transient: boolean;
}
export interface GenerationIssueStatus {
  code: string;
  message: string;
  at: number;
  continuing: boolean;
}
/** Retry decisions are scoped to consecutive request failures, not lifetime totals. */
export class GenerationRecovery {
  private consecutiveFailures = 0;
  lastIssue?: GenerationIssueStatus;
  success() {
    this.consecutiveFailures = 0;
    this.lastIssue = undefined;
  }
  failed(
    issue: GenerationIssue,
    at: number,
  ): "budget_exhausted" | "model_error" | undefined {
    this.consecutiveFailures = issue.transient
      ? this.consecutiveFailures + 1
      : 0;
    const exhausted = issue.transient && this.consecutiveFailures >= 3;
    const continuing = issue.retryable && !exhausted;
    this.lastIssue = {
      code: issue.code,
      message: exhausted
        ? "AI 연결 오류가 3회 연속 발생해 중지했습니다. 연결 상태를 확인해 주세요."
        : issue.message,
      at,
      continuing,
    };
    return continuing
      ? undefined
      : issue.code === "budget_exhausted"
        ? "budget_exhausted"
        : "model_error";
  }
  schedulerFailed(at: number) {
    this.consecutiveFailures = 0;
    this.lastIssue = {
      code: "scheduler_error",
      message: "AI 생성 준비 또는 표시 중 오류가 발생해 중지했습니다.",
      at,
      continuing: false,
    };
  }
}
