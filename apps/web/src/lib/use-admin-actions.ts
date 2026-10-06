import { useCallback, useEffect, useRef, useState } from "react";
export function useAdminActions(refresh: () => Promise<void>) {
  const requests = useRef(new Map<string, AbortController>());
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState("");
  const reset = useCallback(() => {
    for (const controller of requests.current.values()) controller.abort();
    requests.current.clear();
    setPending([]);
    setError("");
  }, []);
  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
    },
    [],
  );
  const run = async (
    key: string,
    task: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (requests.current.has(key)) return false;
    const controller = new AbortController();
    requests.current.set(key, controller);
    setPending([...requests.current.keys()]);
    setError("");
    try {
      await task(controller.signal);
      if (!controller.signal.aborted) await refresh();
      return !controller.signal.aborted;
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "요청을 처리하지 못했습니다.",
        );
      return false;
    } finally {
      if (requests.current.get(key) === controller)
        requests.current.delete(key);
      if (!controller.signal.aborted) setPending([...requests.current.keys()]);
    }
  };
  return {
    run,
    error,
    pending: pending.length > 0,
    busy: (key: string) => pending.includes(key),
    clearError: () => setError(""),
    reset,
  };
}
