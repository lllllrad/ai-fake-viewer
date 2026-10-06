import {
  frameEventSchema,
  audioEventSchema,
  activityEventSchema,
} from "../../contracts/input-events.ts";
function decode(value: string) {
  // Node's permissive decoder otherwise silently ignores malformed characters.
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : undefined;
}
export function readFrameEvent(value: unknown) {
  const parsed = frameEventSchema.safeParse(value);
  if (!parsed.success) return;
  const { type: _, bytes: encoded, ...sample } = parsed.data;
  const bytes = decode(encoded);
  if (!bytes?.length) return;
  return { ...sample, bytes };
}
export function readAudioEvent(value: unknown, chunkSeconds: number) {
  const activity = activityEventSchema.safeParse(value);
  if (activity.success) return activity.data;
  const expectedBytes = chunkSeconds * 16000 * 2;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) return;
  const parsed = audioEventSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.pcm.length !== 4 * Math.ceil(expectedBytes / 3)
  )
    return;
  const pcm = decode(parsed.data.pcm);
  if (!pcm || pcm.length !== expectedBytes) return;
  return { type: "audio" as const, capturedAt: parsed.data.capturedAt, pcm };
}
