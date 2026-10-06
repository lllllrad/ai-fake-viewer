type Cleanup = () => void | Promise<unknown>;

/** Listening and input startup share the already-composed server's cleanup. */
export function launchServer(dependencies: {
  listen(): Promise<unknown>;
  startInputs(): void;
  close(): Promise<unknown>;
}) {
  return initializeServer(async (startup) => {
    startup.add(() => dependencies.close());
    await dependencies.listen();
    dependencies.startInputs();
  });
}

/** Partial composition owns its resources until the normal shutdown hook takes over. */
export interface StartupCleanup {
  add(cleanup: Cleanup): void;
  handoff(closeServer: Cleanup): void;
}

export async function initializeServer<T>(
  assemble: (startup: StartupCleanup) => Promise<T>,
): Promise<T> {
  let cleanups: Cleanup[] = [];
  try {
    return await assemble({
      add: (cleanup) => cleanups.push(cleanup),
      handoff: (closeServer) => {
        cleanups = [closeServer];
      },
    });
  } catch (cause) {
    const failures: unknown[] = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        [cause, ...failures],
        "Server initialization and resource cleanup failed",
        { cause },
      );
    throw cause;
  }
}
