import "server-only";
import { checkLimit, type LimitBucket } from "@/lib/rate-limit";
import { readSession, newSessionId, withSessionCookie } from "@/lib/session";

/** Small helpers shared by every route handler. */

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function notFound(message = "Not found."): Response {
  return json({ error: message }, 404);
}

export function serverError(message = "Something went wrong on our end."): Response {
  return json({ error: message }, 500);
}

export type SessionContext = { sessionId: string; isNew: boolean };

/**
 * Every handler runs under a session. If the visitor has no cookie yet we mint
 * one here and attach it to the response, so the very first API call a browser
 * makes already establishes identity.
 */
export async function withSession(
  handler: (session: SessionContext) => Promise<Response>,
): Promise<Response> {
  const existing = await readSession();
  const session: SessionContext = existing
    ? { sessionId: existing, isNew: false }
    : { sessionId: newSessionId(), isNew: true };

  const response = await handler(session);
  return session.isNew ? withSessionCookie(response, session.sessionId) : response;
}

/** The caller's IP, used only for the aggregate AI ceiling. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimited(bucket: LimitBucket, key: string, message: string): Response | null {
  const result = checkLimit(bucket, key);
  if (result.allowed) {
    return null;
  }
  const headers: Record<string, string> = {};
  if (Number.isFinite(result.retryAfterSeconds)) {
    headers["retry-after"] = String(result.retryAfterSeconds);
  }
  return Response.json({ error: message }, { status: 429, headers });
}

/** Parse a JSON body without letting a malformed one throw a 500. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
