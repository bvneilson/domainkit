"use client";

import { ChevronDown, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { LastChecked, RecordStatusBadge } from "@/components/status";
import { Card, Skeleton } from "@/components/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiDiagnosis, ApiRecord, ApiRecordDiff, Provider } from "@/lib/types";

const SEVERITY_COPY = {
  easy_fix: { label: "Quick fix", color: "emerald" },
  propagation: { label: "Probably just propagation", color: "sky" },
  needs_attention: { label: "Needs a change", color: "amber" },
} as const;

/**
 * What DNS actually returned, next to what we expected.
 *
 * Derived from our own lookup rather than the model, so a failing record always
 * explains itself even when Claude is unreachable.
 */
function RecordDiff({ diff }: { diff: ApiRecordDiff }) {
  // Plain <code> rather than Catalyst's Code: the expected/found values are
  // colour-coded green and red to carry the comparison, and Code's own
  // `text-zinc-950 dark:text-white` would win over that.
  return (
    <div className="mt-4 rounded-lg border border-zinc-950/10 bg-zinc-950/[0.03] p-3 dark:border-white/10 dark:bg-zinc-950/50">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        What we found at {diff.host}
      </p>

      <div className="mt-2.5 space-y-2.5">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Expected</p>
          <code className="mt-1 block break-all rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-xs text-emerald-800 dark:text-emerald-200">
            {diff.expected}
          </code>
        </div>

        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Actually there</p>
          {diff.foundNothing ? (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              No {diff.type} record at all on this host.
            </p>
          ) : (
            <div className="mt-1 space-y-1.5">
              {diff.found.map((value) => (
                <code
                  key={value}
                  className="block break-all rounded-md border border-red-500/25 bg-red-500/10 px-2.5 py-1.5 font-mono text-xs text-red-800 dark:text-red-200"
                >
                  {value}
                </code>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <div className="mt-1 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-zinc-950/[0.04] px-2.5 py-1.5 font-mono text-xs text-zinc-800 ring-1 ring-inset ring-zinc-950/10 dark:bg-zinc-950/60 dark:text-zinc-200 dark:ring-white/10">
          {value}
        </code>
        <CopyButton value={value} label={label} />
      </div>
    </div>
  );
}

export function RecordCard({
  record,
  provider,
  domainId,
}: {
  record: ApiRecord;
  provider: Provider;
  domainId: string;
}) {
  const [showSteps, setShowSteps] = useState(record.status === "pending");
  const [diagnosis, setDiagnosis] = useState<ApiDiagnosis | null>(null);
  const [diff, setDiff] = useState<ApiRecordDiff | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosisNote, setDiagnosisNote] = useState<string | null>(null);

  const hostLabel =
    record.type === "CNAME" ? record.host.split(".").slice(0, -2).join(".") : provider.rootHostLabel;

  async function runDiagnosis() {
    setDiagnosing(true);
    setDiagnosisNote(null);
    try {
      const response = await fetch("/api/ai/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId, recordId: record.id }),
      });
      const body = await response.json();
      // The diff is server-computed from real DNS, so keep it even on a
      // non-OK response — it is the explanation of last resort.
      if (body.diff) setDiff(body.diff);
      if (response.ok) {
        setDiagnosis(body.diagnosis);
        if (body.note) setDiagnosisNote(body.note);
      } else {
        setDiagnosisNote(body.error ?? "We couldn't generate an explanation just now.");
      }
    } catch {
      setDiagnosisNote("We couldn't reach the server for an explanation.");
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-950/10 px-5 py-4 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-950/[0.06] px-1.5 py-0.5 font-mono text-xs font-medium text-zinc-700 dark:bg-white/10 dark:text-zinc-300">
              {record.type}
            </span>
            <LastChecked at={record.last_checked_at} />
          </div>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            {purposeFor(record.type)}
          </p>
        </div>
        <RecordStatusBadge status={record.status} />
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Host" value={record.host} />
          <Field label="Value" value={record.expected_value} />
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          In {provider.label}, put{" "}
          <code className="font-mono text-zinc-700 dark:text-zinc-300">{hostLabel}</code> in
          the host or name field — most providers add your domain to whatever you type there.
        </p>

        {record.status === "checking" && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {record.status === "failed" && record.failure_reason && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-red-700 dark:text-red-200">{record.failure_reason}</p>

                {!diagnosis && (
                  <Button outline className="mt-3" onClick={runDiagnosis} disabled={diagnosing}>
                    <Sparkles className="size-4" aria-hidden />
                    {diagnosing ? "Working it out…" : "Explain what's wrong"}
                  </Button>
                )}
              </div>
            </div>

            {diagnosing && (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}

            {diagnosis && (
              <div className="dk-slide-in mt-4 border-t border-red-500/20 pt-4">
                <Badge color={SEVERITY_COPY[diagnosis.severity].color}>
                  {SEVERITY_COPY[diagnosis.severity].label}
                </Badge>
                <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                  {diagnosis.diagnosis}
                </p>
                <ol className="mt-3 space-y-2">
                  {diagnosis.steps.map((step, index) => (
                    <li key={index} className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-950/[0.06] text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">{step}</span>
                    </li>
                  ))}
                </ol>
                {diagnosis.source === "fallback" && (
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    These are the standard steps for {provider.label}. The AI explanation
                    wasn&apos;t available, but the records above are still correct.
                  </p>
                )}
              </div>
            )}

            {diff && <RecordDiff diff={diff} />}

            {diagnosisNote && (
              <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">{diagnosisNote}</p>
            )}
          </div>
        )}

        {record.status === "verified" && record.failure_reason && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {record.failure_reason}
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowSteps((open) => !open)}
            aria-expanded={showSteps}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:text-white"
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${showSteps ? "rotate-180" : ""}`}
              aria-hidden
            />
            How to add this in {provider.label}
          </button>

          {showSteps && (
            <ol className="mt-3 space-y-2 border-l border-zinc-950/10 pl-4 dark:border-white/10">
              {provider.instructions[record.type].map((step, index) => (
                <li key={index} className="text-sm text-zinc-600 dark:text-zinc-400">
                  {step}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}

function purposeFor(type: ApiRecord["type"]): string {
  switch (type) {
    case "TXT":
      return "Proves you control this domain.";
    case "CNAME":
      return "Lets us sign your mail with DKIM so it isn't marked as spam.";
    case "MX":
      return "Routes mail for this domain to us.";
  }
}
