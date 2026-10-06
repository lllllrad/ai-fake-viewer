import Fastify from "fastify";
import { registerInputRoutes } from "../apps/server/http/routes/inputs.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BroadcastService,
  BroadcastCommandError,
} from "../packages/application/broadcast/service.ts";
import type { BroadcastDependencies } from "../packages/application/broadcast/ports.ts";

function fixture() {
  const state = {
    closed: false,
    requested: false,
    running: false,
    waiting: false,
    ready: true,
    broadcast: 1,
  };
  const events: string[] = [];
  const dependencies: BroadcastDependencies = {
    repository: {
      closed: () => state.closed,
      aiRequested: () => state.requested,
      end: () => {
        events.push("end");
        state.closed = true;
        state.requested = false;
      },
      createNext: () => {
        events.push("new");
        state.closed = false;
        state.requested = false;
        state.broadcast++;
      },
      erase: () => {
        events.push("erase");
        state.requested = false;
      },
      disclose: () => {
        events.push("disclose");
      },
    },
    ai: {
      running: () => state.running,
      start: () => {
        if (!state.ready) throw Error("not ready");
        events.push("ai.start");
        state.requested = true;
        state.running = true;
      },
      stop: (reason, preserve) => {
        events.push(`ai.stop:${reason}`);
        state.running = false;
        if (!preserve) state.requested = false;
      },
      waitForRecovery: () => {
        state.waiting = true;
        events.push("ai.wait");
      },
    },
    cast: {
      disarm: () => {
        events.push("cast.disarm");
      },
      cancelJobs: () => {
        events.push("cast.cancel");
      },
    },
    inputs: {
      startScreen: () => {
        events.push("screen.start");
      },
      startSpeech: () => {
        events.push("speech.start");
      },
      startChat: () => {
        events.push("chat.start");
      },
      start: () => {
        events.push("inputs.start");
      },
      prepareForAi: () => {
        events.push("inputs.prepare");
      },
      stopScreen: () => {
        events.push("screen.stop");
      },
      stopSpeech: () => {
        events.push("speech.stop");
      },
      stopChat: async () => {
        events.push("chat.stop");
      },
    },
  };
  return {
    state,
    events,
    dependencies,
    service: new BroadcastService(dependencies),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("AI enable/disable controls intent without stopping input collection", () => {
  const f = fixture();
  f.service.startInputs();
  assert.equal(f.state.requested, false);
  f.service.enableAi();
  assert.equal(f.state.requested, true);
  f.service.disableAi();
  assert.equal(f.state.requested, false);
  assert.equal(
    f.events.some((e) => e.endsWith(".stop")),
    false,
  );
  assert(f.events.includes("cast.disarm"));
});

test("broadcast end closes synchronously while input teardown drains; starts cannot revive it", async () => {
  const f = fixture(),
    chat = deferred();
  f.dependencies.inputs.stopChat = () => chat.promise;
  f.service.enableAi();
  const ended = f.service.endBroadcast();
  assert.equal(f.state.closed, true);
  assert.equal(f.state.running, false);
  assert.throws(() => f.service.enableAi(), BroadcastCommandError);
  assert.equal(f.service.recoverAi(), false);
  chat.resolve();
  await ended;
  assert.throws(() => f.service.startInputs(), /방송이 종료/);
  assert.equal(f.events.filter((e) => e === "end").length, 1);
  await f.service.endBroadcast();
  assert.equal(f.events.filter((e) => e === "end").length, 1);
});

test("shutdown preserves intent and session, disallows restart, and drains once", async () => {
  const f = fixture();
  f.service.enableAi();
  const a = f.service.shutdown(),
    b = f.service.shutdown();
  assert.equal(a, b);
  await a;
  assert.equal(f.state.closed, false);
  assert.equal(f.state.requested, true);
  assert.equal(f.events.includes("cast.disarm"), false);
  assert.equal(f.events.filter((e) => e === "chat.stop").length, 1);
  assert.throws(() => f.service.enableAi(), /서버를 종료/);
  assert.equal(f.service.recoverAi(), false);
});

test("restart recovery waits without changing enabled intent, then resumes once", () => {
  const f = fixture();
  f.state.requested = true;
  f.state.ready = false;
  assert.equal(f.service.recoverAi(), false);
  assert.equal(f.state.requested, true);
  assert.equal(f.state.waiting, true);
  f.state.ready = true;
  assert.equal(f.service.recoverAi(), true);
  assert.equal(f.service.recoverAi(), true);
  assert.equal(f.events.filter((e) => e === "ai.start").length, 1);
  f.service.disableAi();
  assert.equal(f.service.recoverAi(), false);
});

for (const interrupt of ["end", "shutdown", "stop"] as const) {
  test(`delayed new broadcast cannot override a newer ${interrupt} command`, async () => {
    const f = fixture(),
      chat = deferred();
    f.dependencies.inputs.stopChat = () => chat.promise;
    const creating = f.service.newBroadcast();
    const interruption =
      interrupt === "end"
        ? f.service.endBroadcast()
        : interrupt === "shutdown"
          ? f.service.shutdown()
          : f.service.stopInputs();
    chat.resolve();
    await interruption;
    assert.equal(await creating, false);
    assert.equal(f.state.broadcast, 1);
    assert.equal(f.events.includes("inputs.start"), false);
  });
}

test("new broadcast and reset wait for adapters, preserve ordering and keep AI disabled", async () => {
  const f = fixture();
  f.state.closed = true;
  assert.equal(await f.service.newBroadcast(), true);
  assert.equal(f.state.broadcast, 2);
  assert.equal(f.state.requested, false);
  assert(f.events.indexOf("chat.stop") < f.events.indexOf("new"));
  f.service.enableAi();
  assert.equal(await f.service.eraseData(), true);
  assert.equal(f.state.requested, false);
  assert(f.events.includes("cast.cancel"));
  assert(f.events.lastIndexOf("chat.stop") < f.events.indexOf("erase"));
});

test("a failing adapter cannot prevent stopping the other inputs or closing the broadcast", async () => {
  const f = fixture();
  f.dependencies.inputs.stopScreen = () => {
    throw Error("fixture failure");
  };
  await assert.rejects(f.service.endBroadcast(), /Input shutdown failed/);
  assert.equal(f.state.closed, true);
  assert(f.events.includes("speech.stop"));
  assert(f.events.includes("chat.stop"));
});

test("disclosure stops AI and preserves independent collection", () => {
  const f = fixture();
  f.service.enableAi();
  f.service.disclose();
  assert.equal(f.state.requested, false);
  assert(f.events.includes("disclose"));
  assert.equal(f.events.includes("screen.stop"), false);
});

test("a failed durable end still stops inputs and reports failure instead of claiming deletion", async () => {
  const f = fixture();
  f.service.enableAi();
  f.dependencies.repository.end = () => {
    throw Error("storage unavailable");
  };
  await assert.rejects(f.service.endBroadcast(), /storage unavailable/);
  assert.equal(f.state.running, false);
  assert.equal(f.state.closed, false);
  for (const event of ["screen.stop", "speech.stop", "chat.stop"])
    assert(f.events.includes(event));
});

for (const input of ["screen", "speech", "chat"] as const) {
  test(`${input} start obeys closed, shutdown and adapter-draining boundaries`, async () => {
    const f = fixture(),
      chat = deferred();
    f.service.startInput(input);
    assert(f.events.includes(`${input}.start`));
    f.dependencies.inputs.stopChat = () => chat.promise;
    const stopping = f.service.stopInput("chat");
    assert.throws(
      () => f.service.startInput(input),
      (error: unknown) =>
        error instanceof BroadcastCommandError &&
        error.code === "inputs_stopping",
    );
    chat.resolve();
    await stopping;
    await f.service.endBroadcast();
    assert.throws(
      () => f.service.startInput(input),
      (error: unknown) =>
        error instanceof BroadcastCommandError && error.code === "closed",
    );
    await f.service.newBroadcast();
    await f.service.shutdown();
    assert.throws(
      () => f.service.startInput(input),
      (error: unknown) =>
        error instanceof BroadcastCommandError &&
        error.code === "shutting_down",
    );
  });
}
test("individual and whole-pipeline stops share a pending adapter shutdown", async () => {
  const f = fixture(),
    chat = deferred();
  let calls = 0;
  f.dependencies.inputs.stopChat = () => {
    calls++;
    return chat.promise;
  };
  const individual = f.service.stopInput("chat");
  const all = f.service.stopInputs();
  assert.equal(calls, 1);
  assert.throws(() => f.service.startInputs(), BroadcastCommandError);
  chat.resolve();
  await Promise.all([individual, all]);
  f.service.startInput("chat");
  assert(f.events.includes("chat.start"));
});
test("an individual stop supersedes a pending new-broadcast command", async () => {
  const f = fixture(),
    chat = deferred();
  f.dependencies.inputs.stopChat = () => chat.promise;
  const creating = f.service.newBroadcast();
  const stopping = f.service.stopInput("speech");
  chat.resolve();
  await stopping;
  assert.equal(await creating, false);
  assert.equal(f.state.broadcast, 1);
});
test("screen stop disables AI and cast while speech stop preserves independent AI intent", async () => {
  const f = fixture();
  f.service.enableAi();
  await f.service.stopInput("speech");
  assert.equal(f.state.requested, true);
  await f.service.stopInput("screen");
  assert.equal(f.state.requested, false);
  assert(f.events.includes("cast.disarm"));
});
test("input HTTP routes preserve media responses and enforce broadcast command conflicts", async (t) => {
  const f = fixture();
  const app = Fastify();
  t.after(() => app.close());
  registerInputRoutes(app, f.service, {
    preview: () => undefined,
    transcripts: () => ['{"id":"fixture","text":"SYNTHETIC"}\n'],
  });
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/admin/preview" })).statusCode,
    404,
  );
  const transcript = await app.inject({
    method: "GET",
    url: "/api/admin/transcripts/export",
  });
  assert.equal(transcript.statusCode, 200);
  assert.match(
    String(transcript.headers["content-type"]),
    /application\/x-ndjson/,
  );
  assert.equal(JSON.parse(transcript.body).text, "SYNTHETIC");
  for (const path of ["capture", "audio", "connectors"]) {
    assert.equal(
      (await app.inject({ method: "POST", url: `/api/admin/${path}/start` }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "POST", url: `/api/admin/${path}/stop` }))
        .statusCode,
      200,
    );
  }
  await f.service.endBroadcast();
  for (const path of ["capture", "audio", "connectors"])
    assert.equal(
      (await app.inject({ method: "POST", url: `/api/admin/${path}/start` }))
        .statusCode,
      409,
    );
});

test("configuration change drains inputs and holds the start barrier until installation finishes", async () => {
  const f = fixture(),
    stopped = deferred();
  f.dependencies.inputs.stopChat = () => stopped.promise;
  let applied = false;
  const change = f.service.reconfigureInputs(() => {
    assert.throws(() => f.service.startInputs(), BroadcastCommandError);
    assert.throws(() => f.service.enableAi(), BroadcastCommandError);
    applied = true;
  });
  assert.throws(() => f.service.startInput("speech"), BroadcastCommandError);
  assert.equal(applied, false);
  stopped.resolve();
  assert.equal(await change, true);
  assert.equal(applied, true);
  f.service.startInputs();
});
test("broadcast end supersedes a pending configuration installation", async () => {
  const f = fixture(),
    stopped = deferred();
  f.dependencies.inputs.stopChat = () => stopped.promise;
  let applied = false;
  const change = f.service.reconfigureInputs(() => {
    applied = true;
  });
  const end = f.service.endBroadcast();
  stopped.resolve();
  assert.equal(await change, false);
  await end;
  assert.equal(applied, false);
  assert.equal(f.state.closed, true);
});
test("only the newest configuration installs after shared input teardown", async () => {
  const f = fixture(),
    stopped = deferred();
  f.dependencies.inputs.stopChat = () => stopped.promise;
  const installed: number[] = [];
  const first = f.service.reconfigureInputs(() => {
    installed.push(1);
  });
  const second = f.service.reconfigureInputs(() => {
    installed.push(2);
  });
  stopped.resolve();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(installed, [2]);
});
test("failed configuration installation releases its barrier and does not restart generation", async () => {
  const f = fixture();
  f.service.enableAi();
  await assert.rejects(
    f.service.reconfigureInputs(() => {
      throw new Error("install failed");
    }),
  );
  assert.equal(f.state.requested, false);
  assert.equal(f.state.running, false);
  f.service.startInput("speech");
});
