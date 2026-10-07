import { test } from "node:test";
import assert from "node:assert/strict";
import { PlatformTasks } from "../packages/application/inputs/platform-tasks.ts";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const failures: string[] = [],
    stopped: string[] = [];
  const tasks = new PlatformTasks(
    (p) => {
      failures.push(p);
    },
    (p) => {
      stopped.push(p);
    },
  );
  return { tasks, failures, stopped };
}

test("platform slots exclude duplicate starts through stop notification", async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  let startsDuringNotification: boolean | undefined;
  const tasks = new PlatformTasks(
    () => {},
    (p) => {
      startsDuringNotification = tasks.start(p, async () => {});
    },
  );
  assert(
    tasks.start("youtube", (s) => {
      signal = s;
      return pending.promise;
    }),
  );
  assert.equal(
    tasks.start("youtube", async () => {}),
    false,
  );
  await flush();
  const stop = tasks.stop("youtube");
  assert.equal(signal?.aborted, true);
  assert.equal(
    tasks.start("youtube", async () => {}),
    false,
  );
  pending.resolve();
  await stop;
  assert.equal(startsDuringNotification, false);
  assert(tasks.start("youtube", async () => {}));
  await tasks.stopAll();
});

test("platform stop before queued execution never invokes the adapter", async () => {
  const f = fixture();
  let calls = 0;
  f.tasks.start("chzzk", async () => {
    calls++;
  });
  await f.tasks.stop("chzzk");
  assert.equal(calls, 0);
  assert.deepEqual(f.stopped, ["chzzk"]);
});

test("platform synchronous failure reports once and releases its execution slot", async () => {
  const f = fixture();
  f.tasks.start("youtube", () => {
    throw Error("failed before returning a promise");
  });
  await flush();
  assert.deepEqual(f.failures, ["youtube"]);
  assert(f.tasks.start("youtube", async () => {}));
  await flush();
  assert(f.tasks.start("youtube", async () => {}));
  await f.tasks.stopAll();
});

test("platform cancellation suppresses late failures and concurrent stops share a drain", async () => {
  const f = fixture();
  const pending = deferred();
  f.tasks.start("chzzk", () => pending.promise);
  await flush();
  const a = f.tasks.stop("chzzk"),
    b = f.tasks.stop("chzzk");
  assert.equal(a, b);
  pending.reject(Error("late failure"));
  await a;
  assert.deepEqual(f.failures, []);
  assert.deepEqual(f.stopped, ["chzzk"]);
});

test("platform stop installs drain ownership before synchronous abort listeners", async () => {
  const f = fixture();
  const pending = deferred();
  let reentrant: Promise<void> | undefined;
  f.tasks.start("youtube", (signal) => {
    signal.addEventListener("abort", () => {
      reentrant = f.tasks.stop("youtube");
    });
    return pending.promise;
  });
  await flush();
  const stop = f.tasks.stop("youtube");
  assert.equal(reentrant, stop);
  pending.resolve();
  await stop;
  assert.deepEqual(f.stopped, ["youtube"]);
});

test("whole-platform drain blocks new platforms until every adapter and callback finishes", async () => {
  const f = fixture();
  const a = deferred(),
    b = deferred();
  const aborted: string[] = [];
  for (const [name, pending] of [
    ["youtube", a],
    ["chzzk", b],
  ] as const) {
    f.tasks.start(name, (signal) => {
      signal.addEventListener("abort", () => {
        aborted.push(name);
        assert.equal(
          f.tasks.start("soop", async () => {}),
          false,
        );
      });
      return pending.promise;
    });
  }
  await flush();
  let finished = false;
  const drain = f.tasks.stopAll(() => {
    assert.equal(
      f.tasks.start("soop", async () => {}),
      false,
    );
    finished = true;
  });
  assert.equal(f.tasks.stopAll(), drain);
  assert.deepEqual(aborted, ["youtube", "chzzk"]);
  a.resolve();
  await flush();
  assert.equal(finished, false);
  assert.equal(
    f.tasks.start("youtube", async () => {}),
    false,
  );
  b.resolve();
  await drain;
  assert.equal(finished, true);
  assert.equal(f.tasks.stopping, false);
  assert(f.tasks.start("soop", async () => {}));
  await f.tasks.stopAll();
});

test("platform reporting failures cannot leak a slot or whole-stop barrier", async () => {
  const tasks = new PlatformTasks(
    () => {
      throw Error("report");
    },
    () => {
      throw Error("status");
    },
  );
  tasks.start("youtube", async () => {
    throw Error("adapter");
  });
  await flush();
  assert(tasks.start("youtube", async () => {}));
  await tasks.stopAll(() => {
    throw Error("whole status");
  });
  assert.equal(tasks.stopping, false);
  assert(tasks.start("youtube", async () => {}));
  await tasks.stopAll();
});
