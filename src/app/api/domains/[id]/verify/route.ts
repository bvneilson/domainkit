import { json, notFound, serverError, withSession } from "@/lib/api";
import { isUuid, loadOwnedDomain } from "@/lib/domains";
import { deriveDomainStatus, type RecordStatus } from "@/lib/records";
import { TABLES, supabase } from "@/lib/supabase";
import { verifyRecord } from "@/lib/verify";

export const dynamic = "force-dynamic";

/**
 * Check all three records against live DNS.
 *
 * The records are checked concurrently but judged and written independently, so
 * a failure on one never downgrades another.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/domains/[id]/verify">) {
  return withSession(async ({ sessionId }) => {
    const { id } = await ctx.params;

    if (!isUuid(id)) {
      return notFound("We couldn't find that domain.");
    }

    const domain = await loadOwnedDomain(id, sessionId);
    if (!domain) {
      return notFound("We couldn't find that domain.");
    }

    // Show "checking" while the lookups are in flight so a slow resolver still
    // gives the user feedback rather than a page that looks frozen.
    await supabase()
      .from(TABLES.records)
      .update({ status: "checking" })
      .eq("domain_id", domain.id);

    try {
      const records = await Promise.all(domain.records.map((record) => verifyRecord(record)));

      return json({
        status: deriveDomainStatus(records.map((r) => r.status as RecordStatus)),
        records,
      });
    } catch (error) {
      console.error("[domains:verify]", error);
      return serverError("We couldn't finish checking those records.");
    }
  });
}
