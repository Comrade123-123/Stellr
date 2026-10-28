import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Wobble is private: one password, set as WOBBLE_PASSWORD in Vercel, opens it. Signing in sets
 * an HttpOnly cookie holding an expiry and its HMAC, keyed by the password itself, so changing
 * the password signs everyone out. Server side only.
 */
export const COOKIE = "stellr_wobble";
export const SESSION_DAYS = 30;

const secret = () => process.env.WOBBLE_PASSWORD ?? "";
export const isLocked = () => secret().length === 0;

const sign = (expires: number) => createHmac("sha256", secret()).update(`wobble:${expires}`).digest("base64url");

/** A new session token, good for SESSION_DAYS. */
export function issue() {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  return `${expires}.${sign(expires)}`;
}

/** Whether a cookie value is a live session signed with the current password. */
export function valid(token: string | undefined) {
  if (!token || isLocked()) return false;
  const [e, mac] = token.split(".");
  const expires = Number(e);
  if (!Number.isFinite(expires) || expires < Date.now() || !mac) return false;
  const want = Buffer.from(sign(expires));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Compares a guess with the password in constant time. */
export function matches(guess: string) {
  if (isLocked()) return false;
  const a = createHash("sha256").update(guess).digest();
  const b = createHash("sha256").update(secret()).digest();
  return timingSafeEqual(a, b);
}

/** The session cookie read from a request's Cookie header. */
export function fromRequest(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
