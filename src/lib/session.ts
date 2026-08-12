import { cookies } from "next/headers";

/**
 * There is no sign-in. A UUID in an HTTP-only cookie is the only identity in the
 * system, and every row is keyed by it.
 *
 * Next 16 only allows `.set()` inside a Route Handler or Server Function, never
 * during a Server Component render, so minting is split from reading: pages read
 * the cookie, and `/api/session` is the one place that creates it.
 */

export const SESSION_COOKIE = "domainkit_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

/** Read the current session id, or null if this visitor has never been minted one. */
export async function readSession(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Read the session inside a Route Handler, creating one if it is missing.
 *
 * Returns the id along with the cookie that must be attached to the response,
 * so the caller stays in control of the response object.
 */
export async function requireSession(): Promise<{ sessionId: string; isNew: boolean }> {
  const existing = await readSession();
  if (existing) {
    return { sessionId: existing, isNew: false };
  }
  return { sessionId: newSessionId(), isNew: true };
}

/** Attach the session cookie to an outgoing response. */
export function withSessionCookie(response: Response, sessionId: string): Response {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    `Path=${SESSION_COOKIE_OPTIONS.path}`,
    `Max-Age=${SESSION_COOKIE_OPTIONS.maxAge}`,
    `SameSite=Lax`,
    "HttpOnly",
  ];
  if (SESSION_COOKIE_OPTIONS.secure) {
    parts.push("Secure");
  }
  response.headers.append("set-cookie", parts.join("; "));
  return response;
}
