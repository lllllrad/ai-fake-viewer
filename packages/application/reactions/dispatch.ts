export interface CastDispatchInput {
  sessionId: string;
  memberId: string;
  sessionEpoch: number;
  memberEpoch: number;
  attemptId: string;
}
export interface CastDispatch {
  claim(input: CastDispatchInput): boolean;
}
