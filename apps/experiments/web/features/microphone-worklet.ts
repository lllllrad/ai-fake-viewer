import {
  PcmChunks,
  floatToPcm,
  speechSampleRate,
} from "../../../../packages/domain/inputs/pcm-chunks.ts";
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
class SpeechChunks extends AudioWorkletProcessor {
  private chunks: PcmChunks;
  constructor(options: { processorOptions: { chunkSeconds: number } }) {
    super();
    if (sampleRate !== speechSampleRate)
      throw Error("16 kHz audio context required");
    this.chunks = new PcmChunks(options.processorOptions.chunkSeconds);
  }
  process(inputs: Float32Array[][]) {
    const samples = inputs[0]?.[0];
    if (samples)
      for (const chunk of this.chunks.push(floatToPcm(samples))) {
        this.port.postMessage({ pcm: chunk.pcm, speech: chunk.speech }, [
          chunk.pcm.buffer as ArrayBuffer,
        ]);
      }
    return true;
  }
}
registerProcessor(
  "speech-chunks",
  SpeechChunks as unknown as typeof AudioWorkletProcessor,
);
