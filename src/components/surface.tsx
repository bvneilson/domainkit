import clsx from "clsx";
import type React from "react";

/**
 * The two surface primitives the Catalyst kit doesn't ship. Everything else —
 * Button, Input, Badge, Heading, Text — comes from the kit itself.
 *
 * Written in Catalyst's idiom deliberately: light colour first, `dark:` variant
 * second, plain `clsx`, literal Tailwind colours, no variant library.
 */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        "rounded-xl border border-zinc-950/10 bg-white shadow-sm",
        "dark:border-white/10 dark:bg-zinc-900/60",
      )}
    />
  );
}

/** A skeleton rather than a spinner: it shows the shape of what's coming. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        className,
        "dk-shimmer relative overflow-hidden rounded-md bg-zinc-950/5 dark:bg-white/10",
      )}
    />
  );
}
