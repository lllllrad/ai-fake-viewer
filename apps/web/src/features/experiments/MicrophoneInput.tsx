import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "../../components/ui";

export function MicrophoneInput({
  disabled,
  send,
  onError,
}: {
  disabled: boolean;
  send: (audio: string, mime: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const epoch = useRef(0);
  const cancel = () => {
    epoch.current++;
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.onstop = null;
      if (current.state !== "inactive") current.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    }
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (disabled) {
      cancel();
      setRecording(false);
      setWaiting(false);
    }
  }, [disabled]);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 30 && recorder.current?.state === "recording")
        recorder.current.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);
  const start = async () => {
    const generation = ++epoch.current;
    setWaiting(true);
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error(
          "마이크를 사용할 수 없습니다. localhost 또는 HTTPS에서 접속하거나 텍스트를 입력해 주세요.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (epoch.current !== generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error(
          "이 브라우저의 녹음 형식을 지원하지 않습니다. Chrome이나 텍스트 입력을 사용해 주세요.",
        );
      }
      const current = new MediaRecorder(stream, { mimeType });
      recorder.current = current;
      const parts: Blob[] = [];
      current.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      current.onerror = () => {
        cancel();
        setRecording(false);
        setWaiting(false);
        onError("녹음에 실패했습니다. 마이크를 확인해 주세요.");
      };
      current.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        if (epoch.current !== generation) return;
        setRecording(false);
        setWaiting(true);
        try {
          const blob = new Blob(parts, { type: mimeType });
          if (!blob.size || blob.size > 4 * 1024 * 1024)
            throw Error(
              "녹음이 비어 있거나 너무 큽니다. 짧게 다시 녹음해 주세요.",
            );
          const audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          if (epoch.current === generation)
            await send(audio, mimeType.split(";")[0]);
        } catch (error) {
          if (epoch.current === generation)
            onError(
              error instanceof Error
                ? error.message
                : "음성을 전사하지 못했습니다.",
            );
        } finally {
          if (epoch.current === generation) setWaiting(false);
        }
      };
      current.start();
      setSeconds(0);
      setRecording(true);
      setWaiting(false);
    } catch (error) {
      if (epoch.current === generation) {
        cancel();
        setRecording(false);
        onError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "마이크 권한이 거부되었습니다. 브라우저 권한을 허용하거나 텍스트로 입력해 주세요."
            : error instanceof Error
              ? error.message
              : "마이크를 열지 못했습니다.",
        );
        setWaiting(false);
      }
    }
  };
  return (
    <Button
      type="button"
      className={recording ? "danger" : "secondary"}
      disabled={disabled || waiting}
      onClick={() => (recording ? recorder.current?.stop() : void start())}
    >
      {recording ? (
        <Square size={16} aria-hidden="true" />
      ) : (
        <Mic size={16} aria-hidden="true" />
      )}
      {waiting
        ? "음성 준비·전사 중…"
        : recording
          ? `녹음 전송 · ${seconds}초`
          : "마이크로 말하기"}
    </Button>
  );
}
