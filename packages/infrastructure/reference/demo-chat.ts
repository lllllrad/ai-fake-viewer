/** Synthetic input for the existing demo; never used with live participation. */
export function startDemoChat(ports: {
  status(platform: string, state: string): void;
  grantConsent(platform: string, channel: string, author: string): void;
  receive(platform: string, message: unknown): void;
}) {
  for (const p of ["youtube", "chzzk", "soop"]) ports.status(p, "demo_fixture");
  let n = 0;
  const tick = () => {
    const p = ["youtube", "chzzk", "soop"][n % 3];
    const author = `demo-${n % 4}`;
    ports.grantConsent(p, "demo-channel", author);
    ports.receive(p, {
      platform: p,
      channel: "demo-channel",
      author,
      name: `Demo viewer ${(n % 4) + 1}`,
      text: [
        "[DEMO] 안녕하세요!",
        "[DEMO] 화면 색이 바뀌었네요 🎨",
        "[DEMO] 인공 채팅 데이터입니다.",
      ][n % 3],
      sourceId: `fixture-${Date.now()}-${n++}`,
    });
  };
  tick();
  return setInterval(tick, 4000);
}
