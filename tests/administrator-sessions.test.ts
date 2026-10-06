import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AdministratorSessions,
  equal,
} from "../packages/infrastructure/accounts/administrator-sessions.ts";

const credential = "fixture-admin-credential".repeat(2);

test("administrator sessions survive restart with the same credential until their exact expiry", () => {
  let now = 1_000_000;
  const first = new AdministratorSessions(credential, () => now);
  const cookie = first.issueCookie().split(";", 1)[0];
  const restarted = new AdministratorSessions(credential, () => now);
  assert(restarted.authenticateCookie(cookie));
  now += 7 * 24 * 60 * 60 * 1000 - 1;
  assert(restarted.authenticateCookie(cookie));
  now++;
  assert.equal(restarted.authenticateCookie(cookie), false);
});

test("credential rotation invalidates prior sessions and retains token separation", () => {
  const previous = new AdministratorSessions(credential);
  const next = new AdministratorSessions("fixture-next-credential".repeat(2));
  assert.equal(next.authenticateCookie(previous.issueCookie()), false);
  assert(previous.authenticateToken(credential));
  assert.equal(next.authenticateToken(credential), false);
  assert.equal(previous.authenticateToken(undefined), false);
});

test("browser login issues distinct scoped cookies and logout clears that same scope", () => {
  const sessions = new AdministratorSessions(credential, () => 1_000_000);
  const cookie = sessions.issueCookie();
  assert.notEqual(cookie, sessions.issueCookie());
  assert.match(
    cookie,
    /; HttpOnly; SameSite=Strict; Path=\/api\/admin; Max-Age=604800$/,
  );
  assert(
    sessions.authenticateCookie(
      `preference=compact; ${cookie.split(";", 1)[0]}`,
    ),
  );
  assert.equal(
    sessions.clearCookie(),
    "mixed_chat_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0",
  );
  assert.equal(sessions.authenticateCookie(sessions.clearCookie()), false);
  assert.equal(sessions.authenticateCookie(undefined), false);
});

test("credential comparison accepts exact bytes and rejects other value types", () => {
  assert(equal("fixture", "fixture"));
  assert.equal(equal("fixture", "different"), false);
  assert.equal(equal("가", "a"), false);
  assert.equal(equal(null, "fixture"), false);
});
