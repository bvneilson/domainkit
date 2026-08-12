import "server-only";
import { deriveDomainStatus, type RecordStatus } from "@/lib/records";
import { TABLES, supabase, type DkDomain, type DkDomainRecord } from "@/lib/supabase";

export type DomainWithRecords = DkDomain & {
  status: ReturnType<typeof deriveDomainStatus>;
  records: DkDomainRecord[];
};

/**
 * Load a domain only if it belongs to this session.
 *
 * The session filter is part of the query rather than a check afterwards, so
 * there is no path where a row is fetched first and authorized second.
 */
export async function loadOwnedDomain(
  domainId: string,
  sessionId: string,
): Promise<DomainWithRecords | null> {
  const db = supabase();

  const { data: domain } = await db
    .from(TABLES.domains)
    .select("*")
    .eq("id", domainId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!domain) {
    return null;
  }

  const { data: records } = await db
    .from(TABLES.records)
    .select("*")
    .eq("domain_id", domain.id)
    .order("type", { ascending: true });

  // Present them in the order the user works through them, not alphabetically.
  const order: Record<string, number> = { TXT: 0, CNAME: 1, MX: 2 };
  const sorted = ((records ?? []) as DkDomainRecord[]).sort(
    (a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9),
  );

  return {
    ...(domain as DkDomain),
    status: deriveDomainStatus(sorted.map((r) => r.status as RecordStatus)),
    records: sorted,
  };
}

/** A uuid check so a malformed id becomes a 404 rather than a Postgres error. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
