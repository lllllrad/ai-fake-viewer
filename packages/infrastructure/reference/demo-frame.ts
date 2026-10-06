import sharp from "sharp";

/** Artificial image source for the existing demo, loaded only when demo capture starts. */
export async function renderDemoFrame(index: number) {
  const color = index % 2 ? "#52d6bd" : "#f4b56a";
  const n = index + 1;
  const svg = `<svg width="960" height="540"><rect width="960" height="540" fill="#10242d"/><circle cx="${200 + (n % 4) * 140}" cy="270" r="75" fill="${color}"/><text x="40" y="60" fill="white" font-size="26">DEMO · artificial frame ${n}</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  return { capturedAt: Date.now(), width: 960, height: 540, bytes };
}
