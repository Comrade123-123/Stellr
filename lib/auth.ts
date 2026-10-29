import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { isConfigured as hasStorage, pipeline } from "./redis";

/**
 * Stellr accounts, server side only: sign in with Google (OAuth 2.0 authorization code with
 * PKCE), accounts kept in Upstash Redis, and a session held in an HttpOnly cookie that carries
 * the Google account id, an expiry and their HMAC.
 *
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Google Cloud OAuth client whose redirect
 * URI is <site>/api/auth/google/callback). AUTH_SECRET, if set, signs sessions; otherwise the
 * client secret does, so rotating either signs everyone out.
 */
export const SESSION_COOKIE = "stellr_session";
export const OAUTH_COOKIE = "stellr_oauth";
export const SESSION_DAYS = 30;

// Overridable only so tests can stand in for Google.
const AUTH_URL = process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const USERINFO_URL = process.env.GOOGLE_USERINFO_URL ?? "https://openidconnect.googleapis.com/v1/userinfo";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

function google() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/** Sign-in works only with both a Google client and somewhere to keep accounts. */
export const isEnabled = () => google() !== null && hasStorage();

const key = () => process.env.AUTH_SECRET || google()?.secret || "";
const mac = (text: string) => createHmac("sha256", key()).update(text).digest("base64url");

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  joined: string;
}

/** A session token for this Google account id, good for SESSION_DAYS. */
export function issueSession(id: string) {
  const body = `${Buffer.from(id).toString("base64url")}.${Date.now() + SESSION_DAYS * 86_400_000}`;
  return `${body}.${mac(`session:${body}`)}`;
}

/** The account id a session token belongs to, or null if it's forged, stale or signing is off. */
export function sessionId(token: string | undefined) {
  if (!token || !key()) return null;
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig || !same(mac(`session:${id}.${exp}`), sig)) return null;
  if (!(Number(exp) > Date.now())) return null;
  return Buffer.from(id, "base64url").toString();
}

/** A cookie's value from a request's Cookie header. */
export function cookieFrom(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Only same-site paths, so a crafted link can't bounce someone elsewhere after sign-in. */
export const safeNext = (next: string | null | undefined) => (next && /^\/(?![/\\])/.test(next) ? next.slice(0, 200) : "/account");

/** Where to send the browser to sign in, and the cookie that remembers the attempt (state, PKCE verifier, return path). */
export function beginSignIn(origin: string, next: string) {
  const g = google()!;
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: g.id,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const attempt = `${state}.${verifier}.${Buffer.from(next).toString("base64url")}`;
  return { url: url.toString(), cookie: `${attempt}.${mac(`oauth:${attempt}`)}` };
}

/** The attempt behind a callback, if its cookie is genuine and its state matches. */
export function attemptFor(cookie: string | undefined, state: string | null) {
  const [s, verifier, next, sig] = (cookie ?? "").split(".");
  if (!s || !verifier || !sig || !state || !same(mac(`oauth:${s}.${verifier}.${next}`), sig) || !same(s, state)) return null;
  return { verifier, next: safeNext(Buffer.from(next ?? "", "base64url").toString()) };
}

/**
 * Trades the code for Google's ID token and reads the account from it. The token comes straight
 * from Google's token endpoint over TLS, so its claims are checked (issuer, audience, expiry,
 * verified email) rather than its signature, as OpenID Connect allows for this flow.
 */
export async function finishSignIn(origin: string, code: string, verifier: string) {
  const g = google()!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: g.id,
      client_secret: g.secret,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const { id_token, access_token } = (await res.json()) as { id_token?: string; access_token?: string };
  const claims = JSON.parse(Buffer.from(id_token?.split(".")[1] ?? "", "base64url").toString() || "{}") as Record<string, unknown>;
  if (!ISSUERS.includes(String(claims.iss)) || claims.aud !== g.id || !(Number(claims.exp) * 1000 > Date.now()) || typeof claims.sub !== "string") {
    throw new Error("ID token failed its checks");
  }
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new Error("unverified email");
  // The ID token doesn't always carry the picture; Google's userinfo endpoint does.
  if (typeof claims.picture !== "string" && access_token) {
    const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` }, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ sub?: string; picture?: string }>) : null))
      .catch(() => null);
    if (info?.sub === claims.sub && typeof info.picture === "string") claims.picture = info.picture;
  }
  return {
    id: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : claims.email.split("@")[0],
    picture: typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture : "",
  };
}

const userKey = (id: string) => `user:${id}`;

/** Creates the account on first sign-in, refreshes name and picture after; keeps the join date. */
export async function saveUser(u: Omit<User, "joined">): Promise<User> {
  const existing = await getUser(u.id);
  const user = { ...u, joined: existing?.joined ?? new Date().toISOString() };
  await pipeline([
    ["SET", userKey(u.id), JSON.stringify(user)],
    ["SADD", "users", u.id],
  ]);
  return user;
}

export async function getUser(id: string): Promise<User | null> {
  const [raw] = (await pipeline([["GET", userKey(id)]])) as [string | null];
  return raw ? (JSON.parse(raw) as User) : null;
}

/** Removes the account and everything stored under it. */
export async function deleteUser(id: string) {
  await pipeline([
    ["DEL", userKey(id)],
    ["SREM", "users", id],
  ]);
}

/** The signed-in account behind a request, or null. A deleted account's old cookie finds nothing. */
export async function currentUser(request: Request) {
  const id = sessionId(cookieFrom(request, SESSION_COOKIE));
  return id ? getUser(id) : null;
}
