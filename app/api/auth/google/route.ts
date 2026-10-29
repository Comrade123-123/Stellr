import { NextResponse } from "next/server";
import { OAUTH_COOKIE, beginSignIn, isEnabled, safeNext } from "@/lib/auth";

/** GET /api/auth/google?next=/account → off to Google's account chooser. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!isEnabled()) return NextResponse.redirect(new URL("/account?error=off", url.origin));
  const { url: to, cookie } = beginSignIn(url.origin, safeNext(url.searchParams.get("next")));
  const res = NextResponse.redirect(to);
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
