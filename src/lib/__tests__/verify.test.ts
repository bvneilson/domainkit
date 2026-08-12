import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DnsResult } from "@/lib/dns";
import type { DkDomainRecord } from "@/lib/supabase";

/**
 * These tests are about persistence, not matching — `records.test.ts` already
 * covers which DNS answers count as correct. What matters here is the promise
 * the product makes: each record's verdict is written to that record's own row,
 * one record can never overwrite another's, and every attempt leaves a history
 * row behind even when the check fails.
 *
 * Supabase and the resolver are faked with a small in-memory stand-in so the
 * assertions are about what we wrote, not about the network.
 */

vi.mock("server-only", () => ({}));

const resolveMock = vi.fn<(name: string, type: string) => Promise<DnsResult>>();
vi.mock("@/lib/dns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dns")>()),
  resolve: (name: string, type: string) => resolveMock(name, type),
}));

/** Rows as they exist "in the database", keyed by record id. */
let recordRows: Map<string, DkDomainRecord>;
/** Every history row inserted, in insertion order. */
let historyRows: Array<{ record_id: string; success: boolean; raw_response: unknown }>;
/** Set to a message to make the record UPDATE fail. */
let updateError: string | null;

function fakeTable(table: string) {
  if (table === "dk_domain_records") {
    return {
      update(patch: Partial<DkDomainRecord>) {
        return {
          eq(_column: string, id: string) {
            return {
              select() {
                return {
                  single: async () => {
                    if (updateError) {
                      return { data: null, error: { message: updateError } };
                    }
                    const merged = { ...recordRows.get(id)!, ...patch };
                    recordRows.set(id, merged);
                    return { data: merged, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  if (table === "dk_verification_history") {
    return {
      async insert(row: { record_id: string; success: boolean; raw_response: unknown }) {
        historyRows.push(row);
        return { error: null };
      },
    };
  }

  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  supabase: () => ({ from: fakeTable }),
}));

const { verifyRecord } = await import("@/lib/verify");

const ok = (values: string[]): DnsResult => ({
  kind: "ok",
  values,
  raw: { Status: 0, Answer: values.map((data) => ({ name: "x.", type: 0, TTL: 1, data })) },
});

const TOKEN = "domainkit-verify=token-123";

function seed(record: Partial<DkDomainRecord> & Pick<DkDomainRecord, "id" | "type">) {
  const row: DkDomainRecord = {
    domain_id: "domain-1",
    host: "acme.com",
    expected_value: TOKEN,
    status: "checking",
    last_checked_at: null,
    failure_reason: null,
    ...record,
  } as DkDomainRecord;
  recordRows.set(row.id, row);
  return row;
}

beforeEach(() => {
  recordRows = new Map();
  historyRows = [];
  updateError = null;
  resolveMock.mockReset();
});

describe("verifyRecord", () => {
  it("writes a verified status and reason-free row when DNS matches", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue(ok([`"${TOKEN}"`]));

    const result = await verifyRecord(record);

    expect(result.status).toBe("verified");
    expect(recordRows.get("r-txt")).toMatchObject({ status: "verified", failure_reason: null });
    expect(recordRows.get("r-txt")!.last_checked_at).toEqual(expect.any(String));
  });

  it("writes a failed status with a plain-English reason when DNS does not match", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue(ok([`"domainkit-verify=wrong"`]));

    const result = await verifyRecord(record);

    expect(result.status).toBe("failed");
    expect(recordRows.get("r-txt")!.failure_reason).toEqual(expect.stringContaining("token"));
  });

  it("appends exactly one history row per attempt, including on failure", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue(ok([]));

    await verifyRecord(record);
    await verifyRecord(recordRows.get("r-txt")!);

    expect(historyRows).toHaveLength(2);
    expect(historyRows.every((row) => row.record_id === "r-txt")).toBe(true);
    expect(historyRows.every((row) => row.success === false)).toBe(true);
  });

  it("records what DNS actually returned so the diagnosis has something to read", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue(ok([`"some-other-service=abc"`]));

    await verifyRecord(record);

    expect(historyRows[0].raw_response).toMatchObject({
      kind: "ok",
      found: ["some-other-service=abc"],
    });
  });

  it("marks history successful only when the record verified", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue(ok([`"${TOKEN}"`]));

    await verifyRecord(record);

    expect(historyRows[0].success).toBe(true);
  });

  it("leaves a record pending — not failed — when the resolver itself fails", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue({ kind: "error", message: "DNS servers are slow right now." });

    const result = await verifyRecord(record);

    // We learned nothing about the user's DNS, so blaming them would be a lie.
    expect(result.status).toBe("pending");
    expect(historyRows[0].success).toBe(false);
  });

  it("keeps each record's verdict on its own row when one passes and another fails", async () => {
    const txt = seed({ id: "r-txt", type: "TXT" });
    const mx = seed({
      id: "r-mx",
      type: "MX",
      expected_value: "mx.domainkit.app",
    });

    resolveMock.mockImplementation(async (_name, type) =>
      type === "TXT" ? ok([`"${TOKEN}"`]) : ok(["10 aspmx.l.google.com."]),
    );

    // Concurrent, exactly as the route runs them.
    const [txtResult, mxResult] = await Promise.all([verifyRecord(txt), verifyRecord(mx)]);

    expect(txtResult.status).toBe("verified");
    expect(mxResult.status).toBe("failed");

    // The failing MX check must not have downgraded the TXT row.
    expect(recordRows.get("r-txt")).toMatchObject({ status: "verified", failure_reason: null });
    expect(recordRows.get("r-mx")!.status).toBe("failed");

    // One history row each, attributed to the right record.
    expect(historyRows.map((row) => row.record_id).sort()).toEqual(["r-mx", "r-txt"]);
  });

  it("clears a stale failure reason when a previously failed record now passes", async () => {
    const record = seed({
      id: "r-txt",
      type: "TXT",
      status: "failed",
      failure_reason: "No TXT record was found on this host.",
    });
    resolveMock.mockResolvedValue(ok([`"${TOKEN}"`]));

    await verifyRecord(record);

    expect(recordRows.get("r-txt")).toMatchObject({ status: "verified", failure_reason: null });
  });

  it("surfaces a write failure instead of reporting a result that was never saved", async () => {
    const record = seed({ id: "r-txt", type: "TXT" });
    resolveMock.mockResolvedValue(ok([`"${TOKEN}"`]));
    updateError = "connection reset";

    await expect(verifyRecord(record)).rejects.toThrow(/connection reset/);
  });
});
