export type FixedNotice = { id: string; text: string; expiresAt: number };
export async function dispatchFixedNotice(
  next: () => Promise<{ notice: FixedNotice | null }>,
  connected: () => boolean,
  send: (text: string) => void,
  failed: (id: string) => Promise<unknown>,
) {
  if (!connected()) return;
  const { notice } = await next();
  if (!notice) return;
  if (!connected() || notice.expiresAt <= Date.now()) {
    await failed(notice.id);
    return;
  }
  try {
    send(notice.text);
  } catch {
    await failed(notice.id);
  }
  // sendMessage is void. Only the server-observed matching MESSAGE echo can acknowledge delivery.
}
