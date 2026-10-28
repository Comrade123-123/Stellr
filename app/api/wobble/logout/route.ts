import { cookies } from "next/headers";
import { COOKIE } from "@/lib/wobble-auth";

/** POST /api/wobble/logout → forgets Wobble's session cookie. */
export async function POST() {
  (await cookies()).delete(COOKIE);
  return Response.json({ status: "ok" });
}
