import { cookies } from "next/headers";
import { isConfigured, withinRate } from "@/lib/redis";
import { COOKIE, SESSION_DAYS, isLocked, issue, matches } from "@/lib/wobble-auth";

/** POST /api/wobble/login { password } → sets Wobble's session cookie when the password is right. Five tries a minute per address. */
export async function POST(request: Request) {
  if (isLocked()) return Response.json({ status: "locked" }, { status: 503 });
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isConfigured() && !(await withinRate("wobble-login", caller, 5).catch(() => true))) {
    return Response.json({ status: "rate_limited" }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (typeof body.password !== "string" || !matches(body.password)) return Response.json({ status: "wrong" }, { status: 401 });
  (await cookies()).set(COOKIE, issue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return Response.json({ status: "ok" });
}
