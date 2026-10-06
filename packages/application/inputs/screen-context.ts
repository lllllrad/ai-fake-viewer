export interface ScreenSample<Bytes extends Uint8Array = Uint8Array> {
  capturedAt: number;
  width: number;
  height: number;
  bytes: Bytes;
  sourceWidth?: number;
  sourceHeight?: number;
}
export interface ScreenFrame<
  Bytes extends Uint8Array = Uint8Array,
> extends ScreenSample<Bytes> {
  id: string;
  hash: string;
  source: "obs_program" | "demo";
  maskConfigVersion: string;
}
/** Bounded screen evidence, independent of worker processes and image encoding. */
export class ScreenContext<Bytes extends Uint8Array = Uint8Array> {
  frames: ScreenFrame<Bytes>[] = [];
  dimensions = "";
  private floor = 0;
  constructor(
    private readonly ports: {
      now(): number;
      id(): string;
      digest(bytes: Bytes): string;
    },
  ) {}
  invalidate() {
    this.floor = this.ports.now();
    this.discard();
  }
  discard() {
    this.frames = [];
  }
  begin() {
    this.discard();
    this.dimensions = "";
  }
  accept(
    sample: ScreenSample<Bytes>,
    source: ScreenFrame["source"],
    maskConfigVersion: string,
  ) {
    if (
      !Number.isSafeInteger(sample.capturedAt) ||
      sample.capturedAt <= this.floor
    )
      return false;
    const dimensions = `${sample.sourceWidth ?? sample.width}x${sample.sourceHeight ?? sample.height}`;
    const frame = {
      ...sample,
      id: this.ports.id(),
      hash: this.ports.digest(sample.bytes),
      source,
      maskConfigVersion,
    };
    if (this.dimensions && dimensions !== this.dimensions) this.discard();
    this.dimensions = dimensions;
    this.frames.push(frame);
    this.frames = this.frames
      .filter((f) => f.capturedAt > this.ports.now() - 30000)
      .slice(-10);
    return true;
  }
  recent() {
    const floor = this.ports.now() - 10000;
    return this.frames.filter((f) => f.capturedAt > floor).slice(-3);
  }
  latest() {
    return this.frames.at(-1);
  }
  has(id: string) {
    const floor = this.ports.now() - 30000;
    return this.frames.some((f) => f.id === id && f.capturedAt > floor);
  }
}
