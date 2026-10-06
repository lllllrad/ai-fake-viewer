import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedTokenFile } from "../packages/infrastructure/accounts/encrypted-token-file.ts";
import { platformTokenSchema } from "../packages/contracts/account-tokens.ts";
import { SoopAuth } from "../packages/infrastructure/accounts/soop-auth.ts";
import { ChzzkAuth } from "../packages/infrastructure/accounts/chzzk-auth.ts";
import { YoutubeAuth } from "../packages/infrastructure/accounts/youtube-auth.ts";

const key = "a".repeat(64);
const token = {
  accessToken: "SYNTHETIC_ACCESS",
  refreshToken: "SYNTHETIC_REFRESH",
  expiresAt: 1000,
};
function legacyEnvelope(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "encrypted-token-file-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "tokens");
  const file = new EncryptedTokenFile(key, path, (value) =>
    platformTokenSchema.parse(value),
  );
  return { dir, path, file };
}
test("token storage reads the existing encrypted format and writes a compatible envelope", (t) => {
  const f = fixture(t);
  assert.equal(f.file.read(), undefined);
  writeFileSync(f.path, legacyEnvelope(token));
  assert.deepEqual(f.file.read(), token);
  f.file.write({ ...token, accessToken: "REPLACEMENT" });
  const bytes = readFileSync(f.path);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  const decoded = JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
  assert.deepEqual(decoded, { ...token, accessToken: "REPLACEMENT" });
  assert(!bytes.includes(Buffer.from(token.refreshToken)));
});
test("token replacement uses private files and leaves no temporary files", (t) => {
  const f = fixture(t);
  writeFileSync(f.path, "old");
  chmodSync(f.path, 0o644);
  f.file.write(token);
  if (process.platform !== "win32")
    assert.equal(statSync(f.path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(f.dir), ["tokens"]);
  f.file.remove();
  f.file.remove();
  assert.equal(f.file.read(), undefined);
});
test("failed rename cleans its temporary file without removing the destination", (t) => {
  const f = fixture(t);
  mkdirSync(f.path);
  assert.throws(() => f.file.write(token));
  assert.deepEqual(readdirSync(f.dir), ["tokens"]);
  assert(statSync(f.path).isDirectory());
});
test("schema rejection preserves the previous credentials without exposing values", (t) => {
  const f = fixture(t);
  f.file.write(token);
  const previous = readFileSync(f.path);
  assert.throws(
    () => f.file.write({ ...token, expiresAt: NaN }),
    /storage schema/,
  );
  assert.deepEqual(readFileSync(f.path), previous);
  assert.deepEqual(f.file.read(), token);
});
test("wrong keys, tampering, truncated files and invalid plaintext fail closed", (t) => {
  const f = fixture(t);
  writeFileSync(f.path, legacyEnvelope(token));
  const wrong = new EncryptedTokenFile(
    "b".repeat(64),
    f.path,
    (value) => value,
  );
  assert.throws(() => wrong.read(), /decrypted or validated/);
  const bytes = readFileSync(f.path);
  bytes[bytes.length - 1] ^= 1;
  for (const invalid of [
    bytes,
    Buffer.alloc(0),
    Buffer.alloc(20),
    legacyEnvelope({ accessToken: "PRIVATE_INVALID_VALUE" }),
  ]) {
    writeFileSync(f.path, invalid);
    assert.throws(
      () => f.file.read(),
      (error) => {
        assert(error instanceof Error);
        assert.equal(
          error.message,
          "Stored credentials cannot be decrypted or validated",
        );
        return true;
      },
    );
    assert.equal(existsSync(f.path), true);
  }
});
for (const [name, Constructor] of [
  ["CHZZK", ChzzkAuth],
  ["SOOP", SoopAuth],
  ["YouTube", YoutubeAuth],
] as const) {
  test(
    name +
      " retains existing credentials across reload and rejects invalid persisted state",
    (t) => {
      const f = fixture(t);
      const value =
        name === "YouTube"
          ? {
              ...token,
              channelId: "fixture-channel",
              clientId: "fixture-client",
            }
          : token;
      writeFileSync(f.path, legacyEnvelope(value));
      assert.doesNotThrow(() => new Constructor(key, f.path));
      writeFileSync(
        f.path,
        legacyEnvelope({ accessToken: "MALFORMED_PRIVATE_STATE" }),
      );
      assert.throws(
        () => new Constructor(key, f.path),
        (error) => {
          assert(error instanceof Error);
          assert.match(error.message, /Stored .* credentials/);
          assert(!error.message.includes("MALFORMED_PRIVATE_STATE"));
          return true;
        },
      );
    },
  );
}
