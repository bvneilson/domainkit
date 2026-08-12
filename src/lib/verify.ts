import "server-only";
import { resolve } from "@/lib/dns";
import { matchRecord } from "@/lib/records";
import { TABLES, supabase, type DkDomainRecord } from "@/lib/supabase";

/**
 * Run a live check for one stored record and persist the outcome.
 *
 * Each record is checked and written independently — one record failing never
 * changes another record's row — and every attempt is appended to the history
 * table so the diagnosis endpoint can see what DNS actually returned.
 */
export async function verifyRecord(record: DkDomainRecord): Promise<DkDomainRecord> {
  const db = supabase();
  const dns = await resolve(record.host, record.type);
  const match = matchRecord(record, dns);
  const checkedAt = new Date().toISOString();

  const { data, error } = await db
    .from(TABLES.records)
    .update({
      status: match.status,
      failure_reason: match.reason,
      last_checked_at: checkedAt,
    })
    .eq("id", record.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Could not save the verification result: ${error.message}`);
  }

  await db.from(TABLES.history).insert({
    record_id: record.id,
    success: match.status === "verified",
    raw_response: {
      kind: dns.kind,
      found: match.found,
      reason: match.reason,
      raw: dns.kind === "error" ? null : dns.raw,
    },
  });

  return data as DkDomainRecord;
}

/** The values DNS most recently returned for a record, for the diff and the AI. */
export async function latestFound(recordId: string): Promise<string[]> {
  const { data } = await supabase()
    .from(TABLES.history)
    .select("raw_response")
    .eq("record_id", recordId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = data?.raw_response as { found?: unknown } | null | undefined;
  return Array.isArray(raw?.found) ? (raw.found as string[]) : [];
}
