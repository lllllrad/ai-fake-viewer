export class StaleModelContextError extends Error {
  constructor() {
    super("stale_model_context");
  }
}
