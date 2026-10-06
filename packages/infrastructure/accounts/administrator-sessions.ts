import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function equal(value: unknown, expected: string) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

const cookieName = "mixed_chat_admin";
const ageSeconds = 7 * 24 * 60 * 60;
const attributes = "HttpOnly; SameSite=Strict; Path=/api/admin";

/** Signed sessions survive process restart while the administrator credential is unchanged. */
export class AdministratorSessions {
  constructor(
    private readonly token: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  authenticateToken(value: unknown) {
    return equal(value, this.token);
  }

  private sign(value: string) {
    return createHmac("sha256", this.token).update(value).digest("base64url");
  }

  issueCookie() {
    const payload = `${this.now() + ageSeconds * 1000}.${randomBytes(16).toString("base64url")}`;
    return `${cookieName}=${payload}.${this.sign(payload)}; ${attributes}; Max-Age=${ageSeconds}`;
  }

  clearCookie() {
    return `${cookieName}=; ${attributes}; Max-Age=0`;
  }

  authenticateCookie(cookie: string | undefined) {
    const value = cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!value || !/^\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
      return false;
    const dot = value.lastIndexOf(".");
    const payload = value.slice(0, dot);
    const expires = Number(payload.slice(0, payload.indexOf(".")));
    return (
      Number.isSafeInteger(expires) &&
      expires > this.now() &&
      equal(value.slice(dot + 1), this.sign(payload))
    );
  }
}
