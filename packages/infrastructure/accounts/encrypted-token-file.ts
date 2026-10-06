import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";

/** Compatible envelope: 12-byte IV, 16-byte GCM tag, encrypted JSON. */
export class EncryptedTokenFile<T> {
  private readonly key: Buffer;
  constructor(
    key: string,
    private readonly path: string,
    private readonly parse: (value: unknown) => T,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Invalid encryption key");
    this.key = Buffer.from(key, "hex");
  }
  read(): T | undefined {
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Stored credentials cannot be read");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]);
      return this.parse(JSON.parse(plaintext.toString("utf8")));
    } catch {
      // Do not propagate validation errors that could contain credential values.
      throw new Error("Stored credentials cannot be decrypted or validated");
    }
  }
  write(value: T) {
    let data: T;
    try {
      data = this.parse(value);
    } catch {
      throw new Error("Credentials did not match the storage schema");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(data)),
      cipher.final(),
    ]);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomBytes(12).toString("hex")}.tmp`;
    let descriptor: number | undefined;
    let created = false;
    try {
      // A unique exclusive file avoids reusing an old temporary file's permissions.
      descriptor = openSync(temporary, "wx", 0o600);
      created = true;
      writeFileSync(
        descriptor,
        Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      );
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.path);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (created) rmSync(temporary, { force: true });
    }
  }
  remove() {
    rmSync(this.path, { force: true });
  }
}
