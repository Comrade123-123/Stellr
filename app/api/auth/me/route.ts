import { NextResponse, connection } from "next/server";
import { SESSION_COOKIE, currentUser, deleteUser, isEnabled } from "@/lib/auth";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** GET /api/auth/me → { enabled, user } for the browser asking; user is null when signed out. */
export async function GET(request: Request) {
  await connection();
  if (!isEnabled()) return Response.json({ enabled: false, user: null }, { headers: PRIVATE });
  try {
    const user = await currentUser(request);
    return Response.json({ enabled: true, user: user && { name: user.name, email: user.email, picture: user.picture, joined: user.joined } }, { headers: PRIVATE });
  } catch (error) {
    console.error("[auth] me", error instanceof Error ? error.message : error);
    return Response.json({ enabled: true, user: null, error: "unavailable" }, { status: 502, headers: PRIVATE });
  }
}

/** DELETE /api/auth/me → deletes the signed-in account and signs out. */
export async function DELETE(request: Request) {
  const user = isEnabled() ? await currentUser(request).catch(() => null) : null;
  if (!user) return Response.json({ status: "signed_out" }, { status: 401, headers: PRIVATE });
  try {
    await deleteUser(user.id);
  } catch (error) {
    console.error("[auth] delete", error instanceof Error ? error.message : error);
    return Response.json({ status: "unavailable" }, { status: 502, headers: PRIVATE });
  }
  const res = NextResponse.json({ status: "deleted" }, { headers: PRIVATE });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
