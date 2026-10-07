import { z } from "zod";
import { SpeechProviderError } from "../../application/inputs/transcribe-speech.ts";
import type { Config } from "../../config.ts";

const speechProviders = {
  groq: {
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    key: "GROQ_API_KEY",
  },
  openai: {
    endpoint: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
    key: "OPENAI_API_KEY",
  },
} as const;
export function speechApiKey(provider: Config["audio"]["provider"]) {
  return process.env[speechProviders[provider].key];
}
export function wavFromPcm(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
const responseSchema = z.object({ text: z.string().max(4000) });
/** Multipart transcription protocol shared by the explicitly selected providers. */
export async function providerSpeech(options: {
  provider: Config["audio"]["provider"];
  pcm: Buffer;
  language: string;
  key: string;
  signal: AbortSignal;
  request: typeof fetch;
}): Promise<string> {
  const body = new FormData();
  body.set("model", speechProviders[options.provider].model);
  body.set("response_format", "json");
  if (options.language) body.set("language", options.language);
  body.set(
    "file",
    new Blob([new Uint8Array(wavFromPcm(options.pcm))], { type: "audio/wav" }),
    "audio.wav",
  );
  const result = await options.request(
    speechProviders[options.provider].endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${options.key}` },
      body,
      signal: options.signal,
    },
  );
  if (!result.ok)
    throw new SpeechProviderError(
      result.status === 429
        ? "quota_blocked"
        : result.status === 401 || result.status === 403
          ? "auth_required"
          : "provider_error",
    );
  const raw = await result.text();
  if (raw.length > 8192) throw new SpeechProviderError("provider_error");
  return responseSchema.parse(JSON.parse(raw)).text;
}
