import { json, withSession } from "@/lib/api";

/**
 * Mints the session cookie. This exists as its own route because Next 16 only
 * permits setting a cookie from a Route Handler or Server Function — a page
 * cannot mint one while rendering.
 */
export async function GET() {
  return withSession(async ({ sessionId, isNew }) => json({ sessionId, isNew }));
}
