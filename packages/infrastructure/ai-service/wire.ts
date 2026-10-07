/** JSON transport for transient media; never writes audio/video or requests to disk. */
export function encodeWire(value: unknown): unknown {
  if (value instanceof Uint8Array)
    return { $bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encodeWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeWire(entry)]),
    );
  return value;
}
export function decodeWire(value: unknown): any {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$bytes === "string")
      return Buffer.from(record.$bytes, "base64");
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, decodeWire(entry)]),
    );
  }
  return value;
}
