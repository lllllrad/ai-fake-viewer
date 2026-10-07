/** Shared broadcast/browser framing: mono 16 kHz signed little-endian PCM. */
export const speechSampleRate = 16000;
export const speechRmsThreshold = 140;
export function speechInPcm(pcm: Uint8Array): boolean {
  if (!pcm.length || pcm.length % 2) return false;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let energy = 0;
  for (let offset = 0; offset < pcm.length; offset += 2)
    energy += view.getInt16(offset, true) ** 2;
  return Math.sqrt(energy / (pcm.length / 2)) > speechRmsThreshold;
}
export function floatToPcm(samples: Float32Array): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2),
    view = new DataView(pcm.buffer);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      index * 2,
      Math.round(value * (value < 0 ? 32768 : 32767)),
      true,
    );
  }
  return pcm;
}
export class PcmChunks {
  private buffer: Uint8Array;
  private used = 0;
  constructor(seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 30)
      throw Error("Invalid speech chunk length");
    this.buffer = new Uint8Array(speechSampleRate * 2 * seconds);
  }
  push(bytes: Uint8Array): Array<{ pcm: Uint8Array; speech: boolean }> {
    const chunks: Array<{ pcm: Uint8Array; speech: boolean }> = [];
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(
        bytes.length - offset,
        this.buffer.length - this.used,
      );
      this.buffer.set(bytes.subarray(offset, offset + count), this.used);
      this.used += count;
      offset += count;
      if (this.used === this.buffer.length) {
        const pcm = this.buffer.slice();
        chunks.push({ pcm, speech: speechInPcm(pcm) });
        this.used = 0;
      }
    }
    return chunks;
  }
  clear() {
    this.used = 0;
  }
}
