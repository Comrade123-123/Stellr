import { connection } from "next/server";
import { fromRequest, isLocked, valid } from "@/lib/wobble-auth";

/** GET /api/wobble/session → whether this browser is signed in to Wobble, and whether a password is set at all. */
export async function GET(request: Request) {
  await connection();
  return Response.json({ signedIn: valid(fromRequest(request)), locked: isLocked() }, { headers: { "Cache-Control": "private, no-store" } });
}
