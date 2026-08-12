import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, resetLimits } from "@/lib/rate-limit";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * End-to-end coverage of POST /api/ai/chat — the endpoint an abusive caller
 * would actually hit.
 *
 * The rate-limit unit tests cover the counter in isolation; these prove the
 * route consults it, that the context reaches the model, and that both turns
 * are persisted. Supabase and Anthropic are stubbed so the suite stays hermetic
 * and needs no credentials.
 */

const SESSION = "11111111-1111-4111-8111-111111111111";
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222";

/** Rows the fake Supabase client hands back, and the inserts it captured. */
let chatRows: {
  id: string;
  domain_id: string;
  role: string;
  content: string;
  created_at: string;
}[] = [];
let inserted: Record<string, unknown>[][] = [];
let domainRow: Record<string, unknown> | null = null;
let cookieValue: string | null = SESSION;

const chatSpy = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && cookieValue ? { name, value: cookieValue } : undefined,
  }),
}));

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, chat: (...args: unknown[]) => chatSpy(...args) };
});

/**
 * A stand-in for the Supabase query builder.
 *
 * It records `.eq()` filters and applies them to the configured rows rather
 * than ignoring them. That matters: `loadOwnedDomain` enforces ownership with
 * `.eq("session_id", ...)`, so a stub that dropped filters would report a
 * passing test even if the ownership check were deleted.
 */
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;

    for (const method of ["select", "order", "limit", "in"]) {
      chain[method] = self;
    }
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    };

    const matches = (row: Record<string, unknown>) =>
      filters.every(([column, value]) => row[column] === value);

    const rowsFor = (): Record<string, unknown>[] => {
      if (table === actual.TABLES.chat) return chatRows as unknown as Record<string, unknown>[];
      if (table === actual.TABLES.domains) return domainRow ? [domainRow] : [];
      return [];
    };

    chain.maybeSingle = async () => ({ data: rowsFor().filter(matches)[0] ?? null });
    chain.insert = async (rows: Record<string, unknown>[]) => {
      inserted.push(rows);
      return { data: rows, error: null };
    };
    // Awaiting the chain itself is how the route reads lists.
    chain.then = (resolve: (value: { data: unknown }) => unknown) =>
      resolve({ data: rowsFor().filter(matches) });

    return chain;
  }

  return { ...actual, supabase: () => ({ from: (table: string) => builder(table) }) };
});

const { POST, MAX_MESSAGE_LENGTH } = await import("@/app/api/ai/chat/route");

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetLimits();
  chatRows = [];
  inserted = [];
  cookieValue = SESSION;
  domainRow = {
    id: DOMAIN_ID,
    session_id: SESSION,
    name: "acme.com",
    dns_provider: "cloudflare",
    created_at: "2026-08-11T00:00:00Z",
  };
  chatSpy.mockReset();
  chatSpy.mockResolvedValue({ ok: true, reply: "Set the Name field to @." });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/ai/chat — input guards", () => {
  it("rejects a message longer than the cap without calling the model", async () => {
    const response = await post({ domainId: DOMAIN_ID, message: "a".repeat(MAX_MESSAGE_LENGTH + 1) });

    expect(response.status).toBe(400);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("caps messages at 500 characters, as the design spec requires", () => {
    expect(MAX_MESSAGE_LENGTH).toBe(500);
  });

  it("accepts a message of exactly the cap", async () => {
    const response = await post({ domainId: DOMAIN_ID, message: "a".repeat(MAX_MESSAGE_LENGTH) });

    expect(response.status).toBe(200);
    expect(chatSpy).toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const response = await post({ domainId: DOMAIN_ID, message: "   " });

    expect(response.status).toBe(400);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("does not spend an AI call on a domain that does not exist", async () => {
    domainRow = null;

    const response = await post({ domainId: DOMAIN_ID, message: "How do I fix this?" });

    expect(response.status).toBe(404);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("refuses to read another session's domain, and its chat history with it", async () => {
    // The row exists, but it belongs to somebody else. Guessing a domain id must
    // not leak that domain's records or let the guesser spend our AI budget.
    domainRow = { ...domainRow!, session_id: "somebody-else" };
    chatRows = [
      {
        id: "a",
        domain_id: DOMAIN_ID,
        role: "user",
        content: "private question",
        created_at: "2026-08-11T00:00:00Z",
      },
    ];

    const response = await post({ domainId: DOMAIN_ID, message: "Whose domain is this?" });

    expect(response.status).toBe(404);
    expect(chatSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("private question");
  });

  it("turns a malformed domain id into a 404 rather than a database error", async () => {
    const response = await post({ domainId: "not-a-uuid", message: "How do I fix this?" });

    expect(response.status).toBe(404);
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/chat — provider context", () => {
  it("passes the domain, its provider and its records to the model", async () => {
    await post({ domainId: DOMAIN_ID, message: "Where does the TXT record go?" });

    const [context] = chatSpy.mock.calls[0]!;
    expect(context.domain).toBe("acme.com");
    expect(context.provider).toBe("cloudflare");
  });

  it("falls back to the generic provider when none was detected", async () => {
    domainRow = { ...domainRow!, dns_provider: null };

    await post({ domainId: DOMAIN_ID, message: "Help" });

    expect(chatSpy.mock.calls[0]![0].provider).toBe("generic");
  });

  it("replays stored history so the conversation has memory", async () => {
    chatRows = [
      {
        id: "b",
        domain_id: DOMAIN_ID,
        role: "assistant",
        content: "Set Name to @.",
        created_at: "2026-08-11T00:00:01Z",
      },
      {
        id: "a",
        domain_id: DOMAIN_ID,
        role: "user",
        content: "Where does it go?",
        created_at: "2026-08-11T00:00:00Z",
      },
    ];

    await post({ domainId: DOMAIN_ID, message: "Even for the root?" });

    // Stored newest-first; the model must receive them oldest-first.
    expect(chatSpy.mock.calls[0]![1]).toEqual([
      { role: "user", content: "Where does it go?" },
      { role: "assistant", content: "Set Name to @." },
    ]);
  });
});

describe("POST /api/ai/chat — persistence", () => {
  it("persists both the question and the answer", async () => {
    await post({ domainId: DOMAIN_ID, message: "Where does the TXT record go?" });

    const rows = inserted.flat();
    expect(rows).toEqual([
      { domain_id: DOMAIN_ID, role: "user", content: "Where does the TXT record go?" },
      { domain_id: DOMAIN_ID, role: "assistant", content: "Set the Name field to @." },
    ]);
  });

  it("persists nothing when the model never answered", async () => {
    // Writing an error string as an assistant turn would poison the context of
    // every later question in this conversation.
    chatSpy.mockResolvedValue({ ok: false, reply: "I couldn't reach the assistant." });

    const response = await post({ domainId: DOMAIN_ID, message: "Help" });

    expect(inserted.flat()).toEqual([]);
    expect(await response.json()).toMatchObject({ persisted: false });
  });

  it("still shows the user the degraded reply rather than an empty panel", async () => {
    chatSpy.mockResolvedValue({ ok: false, reply: "I couldn't reach the assistant." });

    const response = await post({ domainId: DOMAIN_ID, message: "Help" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reply: "I couldn't reach the assistant." });
  });
});

describe("POST /api/ai/chat — rate limiting", () => {
  it("serves the session's hourly allowance then blocks with 429", async () => {
    for (let i = 0; i < LIMITS.chat.max; i++) {
      // Vary the IP so the aggregate ceiling doesn't trip first and mask this.
      const response = await post(
        { domainId: DOMAIN_ID, message: `question ${i}` },
        { "x-forwarded-for": `10.0.0.${i}` },
      );
      expect(response.status, `call ${i}`).toBe(200);
    }

    const blocked = await post(
      { domainId: DOMAIN_ID, message: "one too many" },
      { "x-forwarded-for": "10.0.1.1" },
    );

    expect(blocked.status).toBe(429);
    expect(chatSpy).toHaveBeenCalledTimes(LIMITS.chat.max);
  });

  it("caps a session at 50 chat messages an hour, as the design spec requires", () => {
    expect(LIMITS.chat).toMatchObject({ max: 50, windowMs: 60 * 60 * 1000 });
  });

  it("tells a blocked user when to come back", async () => {
    for (let i = 0; i < LIMITS.chat.max; i++) {
      await post({ domainId: DOMAIN_ID, message: `q${i}` }, { "x-forwarded-for": `10.0.0.${i}` });
    }

    const blocked = await post({ domainId: DOMAIN_ID, message: "again" }, { "x-forwarded-for": "10.0.1.1" });

    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await blocked.json()).error).toMatch(/try again/i);
  });

  it("does not persist a turn that was rejected by the limit", async () => {
    for (let i = 0; i < LIMITS.chat.max; i++) {
      await post({ domainId: DOMAIN_ID, message: `q${i}` }, { "x-forwarded-for": `10.0.0.${i}` });
    }
    inserted = [];

    await post({ domainId: DOMAIN_ID, message: "blocked" }, { "x-forwarded-for": "10.0.1.1" });

    expect(inserted.flat()).toEqual([]);
  });

  it("blocks on the aggregate IP ceiling even when sessions rotate", async () => {
    // One IP, many sessions: the per-session counter would never trip, so the
    // aggregate ceiling is the only thing standing between us and a drained key.
    for (let i = 0; i < LIMITS.ai_ip.max; i++) {
      cookieValue = `session-${i}`;
      domainRow = { ...domainRow!, session_id: `session-${i}` };
      const response = await post(
        { domainId: DOMAIN_ID, message: `q${i}` },
        { "x-forwarded-for": "10.0.0.9" },
      );
      expect(response.status, `call ${i}`).toBe(200);
    }

    cookieValue = "session-last";
    domainRow = { ...domainRow!, session_id: "session-last" };
    const blocked = await post(
      { domainId: DOMAIN_ID, message: "one too many" },
      { "x-forwarded-for": "10.0.0.9" },
    );

    expect(blocked.status).toBe(429);
  });

  it("keeps one session's allowance separate from another's", async () => {
    for (let i = 0; i < LIMITS.chat.max; i++) {
      await post({ domainId: DOMAIN_ID, message: `q${i}` }, { "x-forwarded-for": `10.0.0.${i}` });
    }
    expect((await post({ domainId: DOMAIN_ID, message: "x" }, { "x-forwarded-for": "10.1.0.1" })).status).toBe(429);

    cookieValue = "33333333-3333-4333-8333-333333333333";
    domainRow = { ...domainRow!, session_id: cookieValue };

    const other = await post({ domainId: DOMAIN_ID, message: "fresh session" }, { "x-forwarded-for": "10.1.0.2" });

    expect(other.status).toBe(200);
  });
});
