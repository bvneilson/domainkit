"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";

/** Copy-to-clipboard with visible confirmation; every record value gets one. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard access can be blocked; the value is selectable on screen either way.
        }
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        copied
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white",
      )}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
