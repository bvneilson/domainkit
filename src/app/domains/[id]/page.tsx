import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainDetail } from "@/components/domain-detail";
import { isUuid, loadOwnedDomain } from "@/lib/domains";
import { getProvider } from "@/lib/provider";
import { readSession } from "@/lib/session";
import type { ApiRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DomainPage({ params }: PageProps<"/domains/[id]">) {
  const { id } = await params;
  const sessionId = await readSession();

  if (!sessionId || !isUuid(id)) {
    notFound();
  }

  const domain = await loadOwnedDomain(id, sessionId);
  if (!domain) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:text-white"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All domains
      </Link>

      <div className="mt-8">
        <DomainDetail
          domain={{ id: domain.id, name: domain.name }}
          initialRecords={domain.records as ApiRecord[]}
          initialStatus={domain.status}
          provider={getProvider(domain.dns_provider ?? "generic")}
        />
      </div>
    </main>
  );
}
