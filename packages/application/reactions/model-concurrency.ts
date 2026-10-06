/** FIFO provider slots. Canceling queued work never invokes the provider. */
export function limitModelConcurrency<Input, Result>(
  model: (input: Input, signal: AbortSignal) => Promise<Result>,
  maximum = 2,
): (input: Input, signal: AbortSignal) => Promise<Result> {
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new Error("Model concurrency must be a positive safe integer");
  let active = 0;
  const queue: Array<{
    resolve: (release: () => void) => void;
    reject: (reason: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }> = [];
  const releaseOne = () => {
    while (queue.length) {
      const next = queue.shift()!;
      next.signal.removeEventListener("abort", next.abort);
      if (next.signal.aborted) continue;
      next.resolve(makeRelease());
      return;
    }
    active = Math.max(0, active - 1);
  };
  const makeRelease = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseOne();
    };
  };
  const acquire = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (active < maximum) {
      active++;
      return Promise.resolve(makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
          reject(signal.reason);
        },
      };
      queue.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
    });
  };
  return async (input, signal) => {
    const release = await acquire(signal);
    try {
      signal.throwIfAborted();
      return await model(input, signal);
    } finally {
      release();
    }
  };
}
