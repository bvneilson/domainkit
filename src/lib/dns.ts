/**
 * Every DNS lookup in DomainKit goes through Google's DNS-over-HTTPS resolver.
 * No `dig`, no `nslookup`, no Node `dns` module — the app runs on serverless
 * functions where outbound UDP:53 is not something we can rely on, and an HTTPS
 * resolver behaves identically in local dev, in CI, and in production.
 */

export const DOH_ENDPOINT = "https://dns.google/resolve";

export type RecordType = "TXT" | "CNAME" | "MX" | "NS" | "A";

const TYPE_CODES: Record<RecordType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
};

/** The DNS response codes we care about; everything else is a resolver failure. */
const NOERROR = 0;
const NXDOMAIN = 3;

export type DohAnswer = { name: string; type: number; TTL: number; data: string };
export type DohResponse = { Status: number; Answer?: DohAnswer[]; Comment?: string };

export type DnsResult =
  /** The resolver answered. `values` may legitimately be empty (record not set yet). */
  | { kind: "ok"; values: string[]; raw: DohResponse }
  /** The name itself does not exist — a typo, or a domain that was never registered. */
  | { kind: "nxdomain"; raw: DohResponse }
  /** We could not get an answer at all. Never confuse this with "record missing". */
  | { kind: "error"; message: string };

const TIMEOUT_MS = 5000;
const SLOW_RESOLVER_MESSAGE = "DNS servers are slow right now. Try again in a minute.";

async function queryOnce(name: string, type: RecordType): Promise<DohResponse> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Resolver returned HTTP ${response.status}`);
  }

  return (await response.json()) as DohResponse;
}

/**
 * Resolve `name` for `type`, retrying once before giving up.
 *
 * The three outcomes are deliberately distinct: an empty `ok` answer means the
 * user has not added the record yet (or it is still propagating), `nxdomain`
 * means the domain does not exist, and `error` means we do not know. Collapsing
 * these would make the failure messages wrong in the two cases that matter most.
 */
export async function resolve(name: string, type: RecordType): Promise<DnsResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await queryOnce(name, type);

      if (raw.Status === NXDOMAIN) {
        return { kind: "nxdomain", raw };
      }

      if (raw.Status !== NOERROR) {
        throw new Error(`Resolver returned status ${raw.Status}`);
      }

      const wanted = TYPE_CODES[type];
      const values = (raw.Answer ?? []).filter((a) => a.type === wanted).map((a) => a.data);

      return { kind: "ok", values, raw };
    } catch {
      // Both a transport failure and a resolver-side failure are worth one retry;
      // the user-facing message is the same either way.
    }
  }

  return { kind: "error", message: SLOW_RESOLVER_MESSAGE };
}
