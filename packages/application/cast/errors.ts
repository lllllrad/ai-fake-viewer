export class PersonaError extends Error {
  constructor(
    public code: string,
    public statusCode = 409,
    public retryable = false,
  ) {
    super(code);
  }
}
export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PersonaError(code);
}
