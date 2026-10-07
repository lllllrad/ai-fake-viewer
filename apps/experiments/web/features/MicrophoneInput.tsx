import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "../../../web/src/components/ui";
import workletUrl from "./microphone-worklet.ts?worker&url";
import { speechSampleRate } from "../../../../packages/domain/inputs/pcm-chunks.ts";
export function MicrophoneInput({
  disabled,
  chunkSeconds,
  send,
  stop,
  onError,
}: {
  disabled: boolean;
  chunkSeconds: number;
  send: (pcm: string, capturedAt: number, signal: AbortSignal) => Promise<void>;
  stop: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [state, setState] = useState("");
  const epoch = useRef(0);
  const audio = useRef<
    | { context: AudioContext; stream: MediaStream; node: AudioWorkletNode }
    | undefined
  >(undefined);
  const pending = useRef<AbortController | undefined>(undefined);
  const callbacks = useRef({ send, stop, onError });
  callbacks.current = { send, stop, onError };
  const cancel = () => {
    epoch.current++;
    pending.current?.abort();
    pending.current = undefined;
    const current = audio.current;
    audio.current = undefined;
    if (current) {
      current.node.port.onmessage = null;
      current.node.disconnect();
      current.stream.getTracks().forEach((track) => track.stop());
      void current.context.close();
      void callbacks.current.stop().catch(() => {});
    }
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (disabled) {
      cancel();
      setRecording(false);
      setStarting(false);
    }
  }, [disabled]);
  const start = async () => {
    const generation = ++epoch.current;
    setStarting(true);
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioContext === "undefined"
      )
        throw Error("마이크는 localhost 또는 HTTPS에서 사용할 수 있습니다.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (generation !== epoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext({ sampleRate: speechSampleRate });
      await context.audioWorklet.addModule(workletUrl);
      await context.resume();
      if (generation !== epoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      const node = new AudioWorkletNode(context, "speech-chunks", {
        processorOptions: { chunkSeconds },
        channelCount: 1,
        channelCountMode: "explicit",
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const source = context.createMediaStreamSource(stream);
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(context.destination);
      audio.current = { context, stream, node };
      node.onprocessorerror = () => {
        cancel();
        setRecording(false);
        callbacks.current.onError(
          "마이크 음성을 처리하지 못했습니다. 마이크를 다시 시작해 주세요.",
        );
      };
      node.port.onmessage = (
        event: MessageEvent<{ pcm: Uint8Array; speech: boolean }>,
      ) => {
        if (generation !== epoch.current) return;
        if (!event.data.speech) {
          setState("듣는 중 · 무음 청크 건너뜀");
          return;
        }
        if (pending.current) {
          setState("전사 중 · 새 청크 건너뜀");
          return;
        }
        const controller = new AbortController();
        pending.current = controller;
        const bytes = event.data.pcm;
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 8192),
          );
        setState("전사 중 · 계속 듣고 있습니다");
        void callbacks.current
          .send(btoa(binary), Date.now(), controller.signal)
          .then(() => {
            if (generation === epoch.current) setState("듣는 중");
          })
          .catch((error) => {
            if (generation === epoch.current && !controller.signal.aborted) {
              cancel();
              setRecording(false);
              callbacks.current.onError(
                error instanceof Error ? error.message : "전사에 실패했습니다.",
              );
            }
          })
          .finally(() => {
            if (pending.current === controller) pending.current = undefined;
          });
      };
      setRecording(true);
      setState("듣는 중");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close();
      if (generation === epoch.current)
        callbacks.current.onError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "마이크 권한을 허용해 주세요."
            : error instanceof Error
              ? error.message
              : "마이크를 열지 못했습니다.",
        );
    } finally {
      if (generation === epoch.current) setStarting(false);
    }
  };
  return (
    <div>
      <Button
        type="button"
        className={recording ? "danger" : "secondary"}
        disabled={disabled || starting}
        onClick={() => {
          if (recording) {
            cancel();
            setRecording(false);
            setState("");
          } else void start();
        }}
      >
        {recording ? (
          <Square size={16} aria-hidden="true" />
        ) : (
          <Mic size={16} aria-hidden="true" />
        )}
        {starting
          ? "마이크 준비 중…"
          : recording
            ? "마이크 중지"
            : "마이크로 말하기"}
      </Button>
      {recording && (
        <p className="hint" role="status">
          {state} · {chunkSeconds}초 단위
        </p>
      )}
    </div>
  );
}
