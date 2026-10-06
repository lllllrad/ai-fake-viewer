export type ApiFailure = {
  api: string;
  operation: "read" | "send" | "identity";
  state: string;
};
