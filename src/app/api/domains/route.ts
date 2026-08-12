import { badRequest, json, rateLimited, readJson, serverError, withSession } from "@/lib/api";
import { resolve } from "@/lib/dns";
import { detectProvider, getProvider } from "@/lib/provider";
import { buildRecords, deriveDomainStatus, type RecordStatus } from "@/lib/records";
import { TABLES, supabase, type DkDomain, type DkDomainRecord } from "@/lib/supabase";
import { validateDomain } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** List this session's domains with each one's derived status. */
export async function GET() {
  return withSession(async ({ sessionId }) => {
    const db = supabase();

    const { data: domains, error } = await db
      .from(TABLES.domains)
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[domains:list]", error);
      return serverError("We couldn't load your domains.");
    }

    const ids = (domains ?? []).map((d) => d.id);
    const { data: records } = ids.length
      ? await db.from(TABLES.records).select("*").in("domain_id", ids)
      : { data: [] as DkDomainRecord[] };

    const payload = (domains ?? []).map((domain: DkDomain) => {
      const own = (records ?? []).filter((r: DkDomainRecord) => r.domain_id === domain.id);
      return {
        ...domain,
        status: deriveDomainStatus(own.map((r) => r.status as RecordStatus)),
        records: own,
      };
    });

    return json({ domains: payload });
  });
}

/** Add a domain: validate it, detect the provider from its nameservers, generate records. */
export async function POST(request: Request) {
  return withSession(async ({ sessionId }) => {
    const body = await readJson<{ domain?: string }>(request);
    if (!body?.domain) {
      return badRequest("Enter a domain name.");
    }

    const validation = validateDomain(body.domain);
    if (!validation.ok) {
      return badRequest(validation.error);
    }
    const { domain } = validation;

    const limited = rateLimited(
      "domains",
      sessionId,
      "You've added the maximum number of domains for this demo session (5).",
    );
    if (limited) {
      return limited;
    }

    const db = supabase();

    const { data: existing } = await db
      .from(TABLES.domains)
      .select("id")
      .eq("session_id", sessionId)
      .eq("name", domain)
      .maybeSingle();

    if (existing) {
      return badRequest("You've already added that domain.");
    }

    // Detecting the provider is best-effort: a domain that doesn't resolve yet
    // still gets its records, it just gets the generic instructions with it.
    const ns = await resolve(domain, "NS");
    if (ns.kind === "nxdomain") {
      return badRequest("We couldn't find this domain. Check the spelling.");
    }
    const provider = detectProvider(ns.kind === "ok" ? ns.values : []);

    const { data: created, error: insertError } = await db
      .from(TABLES.domains)
      .insert({ session_id: sessionId, name: domain, dns_provider: provider })
      .select()
      .single();

    if (insertError || !created) {
      console.error("[domains:create]", insertError);
      return serverError("We couldn't save that domain.");
    }

    const token = crypto.randomUUID();
    const rows = buildRecords(domain, token).map((record) => ({
      domain_id: created.id,
      type: record.type,
      host: record.host,
      expected_value: record.expected_value,
      status: record.status,
    }));

    const { data: records, error: recordsError } = await db
      .from(TABLES.records)
      .insert(rows)
      .select();

    if (recordsError) {
      // Leaving a domain with no records would strand the user on a broken page.
      await db.from(TABLES.domains).delete().eq("id", created.id);
      console.error("[domains:create-records]", recordsError);
      return serverError("We couldn't generate the DNS records for that domain.");
    }

    return json(
      {
        domain: {
          ...created,
          status: "pending",
          records,
        },
        provider: getProvider(provider),
      },
      201,
    );
  });
}
