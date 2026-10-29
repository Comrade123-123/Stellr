import { NextResponse } from "next/server";
import { OAUTH_COOKIE, SESSION_COOKIE, SESSION_DAYS, attemptFor, cookieFrom, finishSignIn, isEnabled, issueSession, saveUser } from "@/lib/auth";

/** GET /api/auth/google/callback?code&state → Google sends the browser back here; signs in and returns to where it started. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (why: string) => {
    const res = NextResponse.redirect(new URL(`/account?error=${why}`, url.origin));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    return res;
  };
  if (!isEnabled()) return fail("off");
  if (url.searchParams.get("error")) return fail("cancelled");
  const attempt = attemptFor(cookieFrom(request, OAUTH_COOKIE), url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!attempt || !code) return fail("expired");
  try {
    const user = await saveUser(await finishSignIn(url.origin, code, attempt.verifier));
    const res = NextResponse.redirect(new URL(attempt.next, url.origin));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    res.cookies.set(SESSION_COOKIE, issueSession(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    return res;
  } catch (error) {
    console.error("[auth] Google sign-in failed", error instanceof Error ? error.message : error);
    return fail("google");
  }
}
