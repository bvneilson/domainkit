import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetLimits, LIMITS } from "@/lib/rate-limit";
import { CNAME_HOST_PREFIX, CNAME_TARGET, MX_TARGET, TXT_PREFIX } from "@/lib/records";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Route-level coverage of POST /api/domains — the add-a-domain path.
 *
 * The pieces the route composes (validation, provider detection, record
 * generation) each have their own unit tests. What only a route test can prove
 * is the composition: that a request with a session cookie ends up as one
 * domain row keyed to that session, carrying the provider detected from the
 * domain's real nameservers, plus exactly three record rows with the generated
 * expected values. A regression that dropped the MX row or ignored the cookie
 * would leave every unit test green.
 *
 * Supabase and DNS are stubbed so the suite is hermetic and needs no
 * credentials. `scripts/add-domain-evidence.ts` covers the same route against
 * the real database and real DNS.
 */

const SESSION = "11111111-1111-4111-8111-111111111111";
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222";

/** Rows the fake Supabase client hands back, and the writes it captured. */
let domainRows: Record<string, unknown>[] = [];
let cookieValue: string | null = SESSION;
let insertedDomains: Record<string, unknown>[] = [];
let insertedRecords: Record<string, unknown>[] = [];
let deletedDomainIds: unknown[] = [];
/** Set to force the record insert to fail, to exercise the rollback. */
let recordInsertError: { message: string } | null = null;

const resolveSpy = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && cookieValue ? { name, value: cookieValue } : undefined,
  }),
}));

vi.mock("@/lib/dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dns")>();
  return { ...actual, resolve: (...args: unknown[]) => resolveSpy(...args) };
});

/**
 * A stand-in for the Supabase query builder.
 *
 * It records `.eq()` filters and applies them, rather than ignoring them: the
 * duplicate check filters on both `session_id` and `name`, so a stub that
 * dropped filters would report a pass even if the route stopped scoping the
 * lookup to the caller's session.
 */
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    /** Rows staged by `.insert()`, returned by a following `.select()`. */
    let pending: Record<string, unknown>[] | null = null;
    let error: { message: string } | null = null;

    chain.select = () => chain;
    chain.order = () => chain;
    chain.in = () => chain;
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      if (table === actual.TABLES.domains && column === "id") {
        deletedDomainIds.push(value);
      }
      return chain;
    };

    const matches = (row: Record<string, unknown>) =>
      filters.every(([column, value]) => row[column] === value);

    const rowsFor = (): Record<string, unknown>[] =>
      table === actual.TABLES.domains ? domainRows : [];

    chain.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const list = Array.isArray(rows) ? rows : [rows];

      if (table === actual.TABLES.domains) {
        insertedDomains.push(...list);
        pending = list.map((row) => ({
          id: DOMAIN_ID,
          created_at: "2026-08-11T00:00:00Z",
          ...row,
        }));
      } else if (table === actual.TABLES.records) {
        if (recordInsertError) {
          error = recordInsertError;
          pending = [];
        } else {
          insertedRecords.push(...list);
          pending = list.map((row, i) => ({ id: `record-${i}`, ...row }));
        }
      }

      return chain;
    };

    chain.delete = () => chain;
    chain.maybeSingle = async () => ({ data: rowsFor().filter(matches)[0] ?? null, error: null });
    chain.single = async () => ({ data: pending?.[0] ?? null, error });
    // Awaiting the chain itself is how the route reads lists and insert results.
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      resolve({ data: pending ?? rowsFor().filter(matches), error });

    return chain;
  }

  return { ...actual, supabase: () => ({ from: (table: string) => builder(table) }) };
});

const { POST } = await import("@/app/api/domains/route");

/** Make `resolve(domain, "NS")` answer with these nameservers. */
function withNameservers(...values: string[]) {
  resolveSpy.mockResolvedValue({ kind: "ok", values, raw: { Status: 0 } });
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/domains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetLimits();
  domainRows = [];
  insertedDomains = [];
  insertedRecords = [];
  deletedDomainIds = [];
  recordInsertError = null;
  cookieValue = SESSION;
  resolveSpy.mockReset();
  withNameservers("kate.ns.cloudflare.com.", "rob.ns.cloudflare.com.");
});

describe("POST /api/domains — the three generated records", () => {
  it("writes exactly three records: TXT, CNAME and MX", async () => {
    const response = await post({ domain: "acme.com" });

    expect(response.status).toBe(201);
    expect(insertedRecords).toHaveLength(3);
    expect(insertedRecords.map((r) => r.type)).toEqual(["TXT", "CNAME", "MX"]);
  });

  it("puts each record on the host the design spec calls for", async () => {
    await post({ domain: "acme.com" });

    const byType = Object.fromEntries(insertedRecords.map((r) => [r.type, r]));
    expect(byType.TXT.host).toBe("acme.com");
    expect(byType.CNAME.host).toBe(`${CNAME_HOST_PREFIX}.acme.com`);
    expect(byType.MX.host).toBe("acme.com");
  });

  it("generates the expected value for each record", async () => {
    await post({ domain: "acme.com" });

    const byType = Object.fromEntries(insertedRecords.map((r) => [r.type, r]));
    expect(byType.TXT.expected_value).toMatch(
      new RegExp(`^${TXT_PREFIX}[0-9a-f-]{36}$`),
    );
    expect(byType.CNAME.expected_value).toBe(CNAME_TARGET);
    expect(byType.MX.expected_value).toBe(MX_TARGET);
  });

  it("gives every record its own pending status, so they can be fixed one at a time", async () => {
    await post({ domain: "acme.com" });

    expect(insertedRecords.map((r) => r.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("mints a fresh ownership token per domain, so one domain's TXT never verifies another", async () => {
    await post({ domain: "acme.com" });
    const first = insertedRecords.find((r) => r.type === "TXT")!.expected_value;

    insertedRecords = [];
    await post({ domain: "other.com" });
    const second = insertedRecords.find((r) => r.type === "TXT")!.expected_value;

    expect(second).not.toBe(first);
  });

  it("attaches all three records to the domain row it just created", async () => {
    await post({ domain: "acme.com" });

    expect(insertedRecords.map((r) => r.domain_id)).toEqual([DOMAIN_ID, DOMAIN_ID, DOMAIN_ID]);
  });
});

describe("POST /api/domains — session ownership", () => {
  it("keys the domain to the session cookie on the request", async () => {
    await post({ domain: "acme.com" });

    expect(insertedDomains).toHaveLength(1);
    expect(insertedDomains[0].session_id).toBe(SESSION);
    expect(insertedDomains[0].name).toBe("acme.com");
  });

  it("mints a session for a first-time visitor and keys the domain to it", async () => {
    cookieValue = null;

    const response = await post({ domain: "acme.com" });

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");

    const minted = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1];
    expect(insertedDomains[0].session_id).toBe(minted);
  });

  it("normalizes what the user pasted before storing it", async () => {
    await post({ domain: "  HTTPS://WWW.Acme.com/dns  " });

    expect(insertedDomains[0].name).toBe("acme.com");
  });
});

describe("POST /api/domains — provider detection from nameservers", () => {
  it("resolves the domain's NS records to detect the provider", async () => {
    await post({ domain: "acme.com" });

    expect(resolveSpy).toHaveBeenCalledWith("acme.com", "NS");
  });

  it.each([
    ["cloudflare", ["kate.ns.cloudflare.com."]],
    ["godaddy", ["ns01.domaincontrol.com."]],
    ["namecheap", ["dns1.registrar-servers.com."]],
    ["route53", ["ns-1.awsdns-00.org."]],
    ["google", ["ns-cloud-a1.googledomains.com."]],
  ])("stores %s when the nameservers say so", async (expected, nameservers) => {
    withNameservers(...nameservers);

    await post({ domain: "acme.com" });

    expect(insertedDomains[0].dns_provider).toBe(expected);
  });

  it("falls back to the generic provider for nameservers it doesn't recognise", async () => {
    withNameservers("ns1.some-small-host.example.");

    await post({ domain: "acme.com" });

    expect(insertedDomains[0].dns_provider).toBe("generic");
    expect(insertedRecords).toHaveLength(3);
  });

  it("still adds the domain when the resolver itself fails, rather than blaming the user", async () => {
    // We learned nothing about the nameservers, but the three records don't
    // depend on knowing them — only the instructions do.
    resolveSpy.mockResolvedValue({ kind: "error", message: "DNS servers are slow right now." });

    const response = await post({ domain: "acme.com" });

    expect(response.status).toBe(201);
    expect(insertedDomains[0].dns_provider).toBe("generic");
    expect(insertedRecords).toHaveLength(3);
  });

  it("returns the provider's instructions alongside the new domain", async () => {
    const response = await post({ domain: "acme.com" });
    const body = await response.json();

    expect(body.provider.id).toBe("cloudflare");
    expect(body.provider.instructions.CNAME.join(" ")).toContain("DNS only");
    expect(body.domain.records).toHaveLength(3);
  });
});

describe("POST /api/domains — rejected input", () => {
  it("rejects a missing domain", async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    expect(insertedDomains).toHaveLength(0);
  });

  it("rejects a malformed domain without touching DNS or the database", async () => {
    const response = await post({ domain: "not a domain" });

    expect(response.status).toBe(400);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(insertedDomains).toHaveLength(0);
  });

  it("rejects a domain that does not exist in DNS", async () => {
    resolveSpy.mockResolvedValue({ kind: "nxdomain", raw: { Status: 3 } });

    const response = await post({ domain: "acme.com" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "We couldn't find this domain. Check the spelling.",
    });
    expect(insertedDomains).toHaveLength(0);
  });

  it("rejects a domain this session already added", async () => {
    domainRows = [{ id: DOMAIN_ID, session_id: SESSION, name: "acme.com" }];

    const response = await post({ domain: "acme.com" });

    expect(response.status).toBe(400);
    expect(insertedDomains).toHaveLength(0);
  });

  it("lets a different session add the same domain", async () => {
    // The duplicate check is scoped to the caller. Two visitors adding the same
    // domain is normal, and must not look like a duplicate to either of them.
    domainRows = [{ id: DOMAIN_ID, session_id: "somebody-else", name: "acme.com" }];

    const response = await post({ domain: "acme.com" });

    expect(response.status).toBe(201);
    expect(insertedRecords).toHaveLength(3);
  });

  it("stops adding domains once the session cap is reached", async () => {
    for (let i = 0; i < LIMITS.domains.max; i++) {
      const ok = await post({ domain: `acme-${i}.com` });
      expect(ok.status).toBe(201);
    }

    const response = await post({ domain: "one-too-many.com" });

    expect(response.status).toBe(429);
    expect(insertedDomains).toHaveLength(LIMITS.domains.max);
  });
});

describe("POST /api/domains — write failures", () => {
  it("removes the domain if its records could not be written", async () => {
    // A domain with no records would strand the user on a page with nothing to
    // copy and no way to recover.
    recordInsertError = { message: "records insert failed" };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ domain: "acme.com" });

    expect(response.status).toBe(500);
    expect(deletedDomainIds).toContain(DOMAIN_ID);
  });
});
