import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise the real recipes with a synthetic server, never the shared live app.
if (process.platform !== "linux")
  throw new Error(
    "Managed server checks require Linux, bash, curl, setsid and just.",
  );
const execute = promisify(execFile);
const recipes = readFileSync("justfile", "utf8");
// Fail closed if the recipe's isolation assumptions change.
assert.match(recipes, /^port := "3210"$/m);
assert.match(recipes, /^pid_file := "\.local\/server\.pid"$/m);
assert.match(recipes, /^log_file := "\.local\/server\.log"$/m);
const directory = mkdtempSync(join(tmpdir(), "managed-server-check-"));
const reserved = createServer((_request, response) =>
  response.end('{"ok":true}'),
);
await new Promise<void>((done) => reserved.listen(0, "127.0.0.1", done));
const address = reserved.address();
assert(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((done, failed) =>
  reserved.close((error) => (error ? failed(error) : done())),
);
mkdirSync(join(directory, "apps/server"), { recursive: true });
mkdirSync(join(directory, "bin"));
symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
writeFileSync(join(directory, "package.json"), '{"type":"module"}');
writeFileSync(
  join(directory, "justfile"),
  recipes.replace('port := "3210"', `port := "${port}"`),
);
writeFileSync(
  join(directory, "bin/mise"),
  `#!/bin/sh
printf '%s\\n' "$FIXTURE_NODE"
`,
  { mode: 0o700 },
);
writeFileSync(
  join(directory, "apps/server/main.ts"),
  `
import {createServer} from 'node:http';
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ok: true, pid: process.pid}));
});
server.listen(${port}, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
);
const recipe = (name: string) =>
  execute("just", [name], {
    cwd: directory,
    env: {
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      FIXTURE_NODE: process.execPath,
    },
    timeout: 20000,
  });
const pidPath = join(directory, ".local/server.pid");
const health = async () => {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<{ ok: boolean; pid: number }>;
};
try {
  await assert.rejects(recipe("server-status"));
  assert.match((await recipe("server-start")).stdout, /Server started/);
  const first = Number(readFileSync(pidPath, "utf8").trim());
  assert.equal((await health()).pid, first);
  assert.match((await recipe("server-start")).stdout, /already running/);
  assert.equal(Number(readFileSync(pidPath, "utf8").trim()), first);
  assert.match((await recipe("server-status")).stdout, /"ok":true/);
  await recipe("server-restart");
  const second = Number(readFileSync(pidPath, "utf8").trim());
  assert.notEqual(second, first);
  assert.equal((await health()).pid, second);
  await recipe("server-stop");
  assert.equal(existsSync(pidPath), false);
  await assert.rejects(health());
  await assert.rejects(recipe("server-status"));

  // An independently owned fixture listener must be left untouched.
  await new Promise<void>((done) => reserved.listen(port, "127.0.0.1", done));
  await assert.rejects(recipe("server-start"), (error: unknown) => {
    assert(error && typeof error === "object" && "stdout" in error);
    assert.match(String(error.stdout), /unmanaged process/);
    return true;
  });
  assert.equal(existsSync(pidPath), false);
  assert.equal((await health()).ok, true);
  console.log(
    JSON.stringify({
      status: "PASS",
      managedRestart: true,
      duplicateStart: true,
      unmanagedPortPreserved: true,
    }),
  );
} finally {
  if (existsSync(pidPath)) await recipe("server-stop").catch(() => {});
  if (reserved.listening)
    await new Promise<void>((done) => reserved.close(() => done()));
  rmSync(directory, { recursive: true, force: true });
}
