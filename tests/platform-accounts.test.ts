import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  PlatformAccounts,
  AccountActionError,
  type PlatformAccountPorts,
} from "../packages/application/accounts/platform-accounts.ts";
import { registerPlatformAccountRoutes } from "../apps/server/http/routes/platform-accounts.ts";
import { SoopAuth } from "../packages/soop.ts";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture() {
  const events: string[] = [];
  let now = 1000;
  const settings = {
    demo: false,
    youtube: {
      enabled: true,
      configured: true,
      redirectUri: "http://localhost/youtube",
    },
    chzzk: {
      enabled: true,
      configured: true,
      redirectUri: "http://localhost/chzzk",
    },
    soop: {
      enabled: true,
      clientId: "fixture",
      clientSecret: "fixture-secret",
      redirectUri: "http://localhost/soop",
    },
  };
  const ports: PlatformAccountPorts = {
    settings: () => settings,
    youtube: {
      authorizationUrl: () => {
        events.push("youtube:authorize");
        return "https://example.invalid/youtube";
      },
      callback: async () => {
        events.push("youtube:callback");
      },
      forget: () => {
        events.push("youtube:forget");
      },
    },
    chzzk: {
      authorizationUrl: () => {
        events.push("chzzk:authorize");
        return "https://example.invalid/chzzk";
      },
      cancel: () => {
        events.push("chzzk:cancel");
      },
      exchange: async () => {
        events.push("chzzk:exchange");
      },
      forget: () => {
        events.push("chzzk:forget");
      },
    },
    soop: {
      authorizationUrl: () => {
        events.push("soop:authorize");
        return "https://example.invalid/soop";
      },
      exchange: async () => {
        events.push("soop:exchange");
      },
      forget: () => {
        events.push("soop:forget");
      },
    },
    stop: async (platform) => {
      events.push(platform + ":stop");
    },
    resetYoutubeNotices: () => {
      events.push("youtube:reset");
    },
    soopStatus: (state) => {
      events.push("soop:" + state);
    },
    now: () => now,
  };
  return {
    accounts: new PlatformAccounts(ports),
    ports,
    settings,
    events,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
for (const platform of ["youtube", "chzzk", "soop"] as const) {
  test(
    platform +
      " authorization requires enabled live configuration before invoking its adapter",
    () => {
      const f = fixture();
      f.settings.demo = true;
      assert.throws(() => f.accounts.authorize(platform), AccountActionError);
      f.settings.demo = false;
      f.settings[platform].enabled = false;
      assert.throws(() => f.accounts.authorize(platform), AccountActionError);
      assert.deepEqual(f.events, []);
    },
  );
  test(
    platform +
      " disconnect drains only its receiver before forgetting credentials",
    async () => {
      const f = fixture();
      await f.accounts.disconnect(platform);
      assert.deepEqual(f.events.slice(0, 2), [
        platform + ":stop",
        platform + ":forget",
      ]);
      assert(!f.events.some((e) => !e.startsWith(platform + ":")));
    },
  );
}
test("authorization is unavailable while that account disconnect is draining", async () => {
  const f = fixture();
  let finish!: () => void;
  f.ports.stop = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const stopped = f.accounts.disconnect("chzzk");
  assert.throws(() => f.accounts.authorize("chzzk"), AccountActionError);
  await assert.rejects(
    f.accounts.completeChzzk({ code: "code", state: "state" }),
    AccountActionError,
  );
  assert.match(f.accounts.authorize("youtube"), /youtube/);
  finish();
  await stopped;
  assert.match(f.accounts.authorize("chzzk"), /chzzk/);
});
test("CHZZK denial consumes its state without exchanging credentials", async () => {
  const f = fixture();
  await assert.rejects(
    f.accounts.completeChzzk({ state: "state", error: "denied" }),
    /CHZZK_USER_DENIED/,
  );
  assert.deepEqual(f.events, ["chzzk:cancel"]);
});
test("YouTube callback stops its receiver only after successful account exchange", async () => {
  const f = fixture();
  await f.accounts.completeYoutube({ state: "state", code: "code" });
  assert.deepEqual(f.events, ["youtube:callback", "youtube:stop"]);
  f.events.length = 0;
  f.ports.youtube.callback = async () => {
    throw new Error("fixture failure");
  };
  await assert.rejects(f.accounts.completeYoutube({ state: "state" }));
  assert.deepEqual(f.events, []);
});
test("SOOP authorization expires at five minutes and one successful callback consumes it", async () => {
  const f = fixture();
  f.accounts.authorize("soop");
  f.advance(300000);
  await assert.rejects(f.accounts.completeSoop({ code: "code" }), /EXPIRED/);
  assert(!f.events.includes("soop:exchange"));
  f.accounts.authorize("soop");
  await f.accounts.completeSoop({ code: "code" });
  await assert.rejects(f.accounts.completeSoop({ code: "code" }), /EXPIRED/);
  assert.equal(f.events.filter((e) => e === "soop:exchange").length, 1);
});
test("a superseded SOOP exchange cannot report ready or overwrite the current status", async () => {
  const f = fixture();
  let finish!: () => void;
  f.ports.soop.exchange = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  f.accounts.authorize("soop");
  const callback = f.accounts.completeSoop({ code: "first" });
  f.accounts.authorize("soop");
  finish();
  await assert.rejects(callback, /authorization changed/);
  assert(
    !f.events.some((e) => e === "soop:auth_ready" || e === "soop:auth_failed"),
  );
});
test("SOOP adapter does not persist an exchange superseded by a new authorization", async () => {
  const dir = mkdtempSync(join(tmpdir(), "account-workflow-"));
  let respond!: (response: Response) => void;
  const path = join(dir, "tokens");
  const auth = new SoopAuth(
    "a".repeat(64),
    path,
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  try {
    const exchange = auth.exchange(
      "code",
      "client",
      "secret",
      "http://localhost/callback",
    );
    auth.authorizationUrl("client");
    respond(
      Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        expires_in: 3600,
      }),
    );
    await assert.rejects(exchange, /authorization changed/);
    assert.equal(auth.token, undefined);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("account HTTP routes retain callback paths and UTF-8 success and failure responses", async () => {
  const f = fixture(),
    app = Fastify();
  registerPlatformAccountRoutes(app, f.accounts);
  try {
    const youtube = await app.inject(
      "/oauth/youtube/callback?state=fixture&code=fixture",
    );
    assert.equal(youtube.statusCode, 200);
    assert.match(youtube.headers["content-type"]!, /charset=utf-8/);
    assert.match(youtube.body, /연결 완료/);
    const failed = await app.inject("/oauth/youtube/callback");
    assert.equal(failed.statusCode, 400);
    f.settings.demo = true;
    const blocked = await app.inject({
      method: "POST",
      url: "/api/admin/chzzk/authorize",
    });
    assert.equal(blocked.statusCode, 409);
    f.settings.demo = false;
    f.ports.chzzk.exchange = async () => {
      throw new Error("private provider details");
    };
    const chzzk = await app.inject(
      "/oauth/chzzk/callback?code=fixture&state=" + "a".repeat(64),
    );
    assert.equal(chzzk.statusCode, 400);
    assert(!chzzk.body.includes("private provider details"));
  } finally {
    await app.close();
  }
});
