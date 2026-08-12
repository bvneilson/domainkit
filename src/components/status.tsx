"use client";

import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DomainStatus, RecordStatus } from "@/lib/types";

const RECORD_STATUS = {
  verified: { label: "Verified", color: "emerald", Icon: CheckCircle2 },
  failed: { label: "Not found", color: "red", Icon: AlertTriangle },
  checking: { label: "Checking…", color: "sky", Icon: Loader2 },
  pending: { label: "Waiting", color: "zinc", Icon: Clock },
} as const;

export function RecordStatusBadge({ status }: { status: RecordStatus }) {
  const { label, color, Icon } = RECORD_STATUS[status];
  return (
    <Badge
      color={color}
      className={`inline-flex items-center gap-1.5${status === "verified" ? " dk-pop" : ""}`}
    >
      <Icon className={`size-3.5 ${status === "checking" ? "animate-spin" : ""}`} aria-hidden />
      {label}
    </Badge>
  );
}

const DOMAIN_STATUS = {
  verified: { label: "Verified", color: "emerald", Icon: CheckCircle2 },
  action_needed: { label: "Action needed", color: "amber", Icon: AlertTriangle },
  checking: { label: "Checking…", color: "sky", Icon: Loader2 },
  pending: { label: "Waiting for setup", color: "zinc", Icon: Clock },
} as const;

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  const { label, color, Icon } = DOMAIN_STATUS[status];
  return (
    <Badge color={color} className="inline-flex items-center gap-1.5">
      <Icon className={`size-3.5 ${status === "checking" ? "animate-spin" : ""}`} aria-hidden />
      {label}
    </Badge>
  );
}

/** "Last checked 30s ago", refreshed on a timer so it stays honest. */
export function LastChecked({ at }: { at: string | null }) {
  if (!at) {
    return <span className="text-xs text-zinc-500 dark:text-zinc-400">Never checked</span>;
  }
  return <span className="text-xs text-zinc-500 dark:text-zinc-400">Last checked {relativeTime(at)}</span>;
}

export function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
