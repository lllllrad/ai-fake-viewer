import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { InputWorkerSession } from "../packages/infrastructure/inputs/worker-session.ts";

class Child extends EventEmitter {
  connected = true;
  sent: object[] = [];
  kills = 0;
  failSend = false;
  send(message: object) {
    if (this.failSend) throw new Error("closed IPC");
    this.sent.push(message);
    return true;
  }
  kill() {
    this.kills++;
    return true;
  }
}
function fixture() {
  const children: Child[] = [];
  const timers: { action: () => void; canceled: boolean; ms: number }[] = [];
  const messages: unknown[] = [];
  const exits: unknown[] = [];
  let errors = 0;
  const callbacks = {
    message: (value: unknown) => {
      messages.push(value);
    },
    error: () => {
      errors++;
    },
    exit: (code: number | null, signal: string | null) => {
      exits.push([code, signal]);
    },
  };
  const session = new InputWorkerSession(
    new URL("file:///synthetic-worker.mjs"),
    () => {
      const child = new Child();
      children.push(child);
      return child;
    },
    (ms, action) => {
      const timer = { ms, action, canceled: false };
      timers.push(timer);
      return () => {
        timer.canceled = true;
      };
    },
  );
  return {
    session,
    children,
    timers,
    messages,
    exits,
    callbacks,
    errors: () => errors,
  };
}
test("input worker forwards current events and ignores released generations", () => {
  const f = fixture();
  f.session.start({ type: "start" }, f.callbacks);
  const old = f.children[0];
  const queuedMessage = old.listeners("message")[0];
  const queuedError = old.listeners("error")[0];
  const queuedExit = old.listeners("exit")[0];
  old.emit("message", "current");
  old.emit("error", new Error("current"));
  f.session.start({ type: "start" }, f.callbacks);
  assert.equal(f.children.length, 1);
  f.session.stop();
  f.session.start({ type: "start" }, f.callbacks);
  queuedMessage("late");
  queuedError(new Error("late"));
  queuedExit(1, null);
  old.emit("error", new Error("orphan IPC"));
  assert.deepEqual(f.messages, ["current"]);
  assert.equal(f.errors(), 1);
  assert.deepEqual(f.exits, []);
  assert.equal(f.session.child, f.children[1]);
  f.children[1].emit("message", "replacement");
  assert.deepEqual(f.messages, ["current", "replacement"]);
  f.session.stop();
});
test("natural exit releases the handle before the owner restarts", () => {
  const f = fixture();
  f.session.start(
    {},
    {
      ...f.callbacks,
      exit: (code, signal) => {
        f.callbacks.exit(code, signal);
        f.session.start({}, f.callbacks);
      },
    },
  );
  f.children[0].emit("exit", 2, "SIGTERM");
  assert.deepEqual(f.exits, [[2, "SIGTERM"]]);
  assert.equal(f.session.child, f.children[1]);
  f.session.stop();
});
test("superseded retry cannot run or erase the current cancellation handle", () => {
  const f = fixture();
  let calls = 0;
  f.session.retry(10, () => {
    calls++;
  });
  f.session.retry(20, () => {
    calls++;
  });
  assert.equal(f.timers[0].canceled, true);
  f.timers[0].action();
  assert.equal(calls, 0);
  f.session.stop();
  assert.equal(f.timers[1].canceled, true);
  f.timers[1].action();
  assert.equal(calls, 0);
  f.session.retry(30, () => {
    calls++;
  });
  f.timers[2].action();
  f.timers[2].action();
  assert.equal(calls, 1);
});
for (const connected of [true, false]) {
  test(
    "stop releases and kills a child even with unavailable IPC: " + connected,
    () => {
      const f = fixture();
      f.session.start({}, f.callbacks);
      const child = f.children[0];
      child.connected = connected;
      child.failSend = true;
      f.session.stop();
      f.session.stop();
      assert.equal(child.kills, 1);
      assert.equal(f.session.child, undefined);
      assert.deepEqual(f.exits, []);
    },
  );
}
test("spawn failure reports one error and leaves the session restartable", () => {
  let errors = 0;
  let spawns = 0;
  const child = new Child();
  const session = new InputWorkerSession(
    new URL("file:///synthetic-worker.mjs"),
    () => {
      if (++spawns === 1) throw new Error("spawn failed");
      return child;
    },
  );
  const callbacks = {
    message() {},
    error() {
      errors++;
    },
    exit() {},
  };
  session.start({}, callbacks);
  assert.equal(errors, 1);
  assert.equal(session.child, undefined);
  session.start({}, callbacks);
  assert.equal(session.child, child);
  session.stop();
});
test("initial IPC failure releases the child even if error reporting throws", () => {
  const child = new Child();
  child.failSend = true;
  const session = new InputWorkerSession(
    new URL("file:///synthetic-worker.mjs"),
    () => child,
  );
  assert.throws(
    () =>
      session.start(
        {},
        {
          message() {},
          error() {
            throw new Error("report failed");
          },
          exit() {},
        },
      ),
    /report failed/,
  );
  assert.equal(child.kills, 1);
  assert.equal(session.child, undefined);
});
