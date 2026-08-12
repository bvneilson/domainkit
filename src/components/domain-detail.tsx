"use client";

import { CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HelpChat } from "@/components/help-chat";
import { RecordCard } from "@/components/record-card";
import { DomainStatusBadge } from "@/components/status";
import { Card } from "@/components/surface";
import { Button } from "@/components/ui/button";
import type { ApiRecord, DomainStatus, Provider } from "@/lib/types";

/**
 * The verification screen. Records are rendered and refreshed individually, so
 * the user can fix and re-check one at a time rather than being told the whole
 * domain is wrong.
 */
export function DomainDetail({
  domain,
  initialRecords,
  initialStatus,
  provider,
}: {
  domain: { id: string; name: string };
  initialRecords: ApiRecord[];
  initialStatus: DomainStatus;
  provider: Provider;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [status, setStatus] = useState(initialStatus);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState(false);

  const verify = useCallback(async () => {
    setVerifying(true);
    setError(null);
    setRecords((current) => current.map((record) => ({ ...record, status: "checking" as const })));

    try {
      const response = await fetch(`/api/domains/${domain.id}/verify`, { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "We couldn't check those records.");
        // Put the records back the way they were rather than leaving them
        // stuck on "checking" forever.
        setRecords(initialRecords);
        return;
      }

      setRecords(body.records);
      setStatus(body.status);
      if (body.status === "verified") {
        setJustVerified(true);
      }
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setRecords(initialRecords);
    } finally {
      setVerifying(false);
    }
  }, [domain.id, initialRecords]);

  useEffect(() => {
    if (!justVerified) return;
    const timer = setTimeout(() => setJustVerified(false), 6000);
    return () => clearTimeout(timer);
  }, [justVerified]);

  const verifiedCount = records.filter((record) => record.status === "verified").length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">
              {domain.name}
            </h1>
            <DomainStatusBadge status={status} />
          </div>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {verifiedCount} of {records.length} records verified · DNS run by {provider.label}
          </p>
        </div>

        <Button color="emerald" onClick={verify} disabled={verifying}>
          {verifying ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking DNS…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" aria-hidden />
              {verifiedCount > 0 ? "Check again" : "Verify records"}
            </>
          )}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {error}
        </p>
      )}

      {justVerified && (
        <div className="dk-pop mt-6 flex items-start gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <p className="text-sm text-emerald-700 dark:text-emerald-200">
            All three records are live. {domain.name} is verified.
          </p>
        </div>
      )}

      {provider.notes.length > 0 && (
        <Card className="mt-6 flex items-start gap-2.5 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
          <div className="min-w-0 text-sm text-zinc-600 dark:text-zinc-400">
            {provider.notes.map((note, index) => (
              <p key={index} className={index > 0 ? "mt-1.5" : undefined}>
                {note}
              </p>
            ))}
          </div>
        </Card>
      )}

      <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
        DNS changes usually show up within 5–15 minutes, though providers are allowed to take up to
        48 hours. If a record was correct a minute ago and still isn&apos;t showing, it&apos;s
        almost always propagation rather than a mistake.
      </p>

      <div className="mt-6 space-y-4">
        {records.map((record) => (
          <RecordCard
            key={record.id}
            record={record}
            provider={provider}
            domainId={domain.id}
          />
        ))}
      </div>

      <HelpChat domainId={domain.id} domainName={domain.name} />
    </>
  );
}
