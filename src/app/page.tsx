import { Globe, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { AddDomain } from "@/components/add-domain";
import { DomainStatusBadge } from "@/components/status";
import { Card } from "@/components/surface";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { deriveDomainStatus, type RecordStatus } from "@/lib/records";
import { readSession } from "@/lib/session";
import { TABLES, supabase, type DkDomain, type DkDomainRecord } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function loadDomains(sessionId: string | null) {
  if (!sessionId) return [];

  const db = supabase();
  const { data: domains } = await db
    .from(TABLES.domains)
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (!domains?.length) return [];

  const { data: records } = await db
    .from(TABLES.records)
    .select("*")
    .in(
      "domain_id",
      domains.map((d) => d.id),
    );

  return (domains as DkDomain[]).map((domain) => {
    const own = ((records ?? []) as DkDomainRecord[]).filter((r) => r.domain_id === domain.id);
    return {
      ...domain,
      status: deriveDomainStatus(own.map((r) => r.status as RecordStatus)),
      verified: own.filter((r) => r.status === "verified").length,
      total: own.length,
    };
  });
}

export default async function DashboardPage() {
  // Pages may only read the cookie — Next 16 forbids setting one during render,
  // so /api/session is what mints it on the first write.
  const sessionId = await readSession();
  const domains = await loadDomains(sessionId);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="size-4" aria-hidden />
        DomainKit
      </div>

      <Heading className="mt-4 sm:text-3xl">Prove you own your domain.</Heading>
      <Text className="mt-3 max-w-xl">
        Add a domain and we&apos;ll give you three DNS records to set up, written for whoever runs
        your DNS. When one doesn&apos;t verify, we tell you exactly what&apos;s wrong instead of
        just saying &ldquo;failed&rdquo;.
      </Text>

      <div className="mt-8">
        <AddDomain />
      </div>

      <section className="mt-14">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Your domains</h2>

        {domains.length === 0 ? (
          <Card className="mt-4 px-6 py-12 text-center">
            <Globe className="mx-auto size-8 text-zinc-400 dark:text-zinc-600" aria-hidden />
            <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No domains yet
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Add one above to see the records you need. Nothing to sign up for — everything is
              tied to this browser session.
            </p>
          </Card>
        ) : (
          <ul className="mt-4 space-y-3">
            {domains.map((domain) => (
              <li key={domain.id}>
                <Link
                  href={`/domains/${domain.id}`}
                  className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Card className="flex items-center justify-between gap-4 px-5 py-4 transition hover:border-zinc-950/20 hover:bg-zinc-50 dark:hover:border-white/20 dark:hover:bg-zinc-900">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-950 dark:text-white">
                        {domain.name}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {domain.verified} of {domain.total} records verified
                      </p>
                    </div>
                    <DomainStatusBadge status={domain.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-12 flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        DNS answers come from Google&apos;s public resolver, so what you see here is what the rest
        of the internet sees.
      </p>
    </main>
  );
}
