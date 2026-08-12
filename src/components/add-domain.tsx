"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateDomain } from "@/lib/validate";

/**
 * The whole first step of the product. Validation runs client-side first so a
 * typo is caught instantly, and again on the server because the client is not
 * a trustworthy gatekeeper.
 */
export function AddDomain({ onAdded }: { onAdded?: (id: string) => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const validation = validateDomain(value);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: validation.domain }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "We couldn't add that domain.");
        return;
      }

      setValue("");
      onAdded?.(body.domain.id);
      router.push(`/domains/${body.domain.id}`);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="domain" className="sr-only">
            Domain name
          </label>
          <Input
            id="domain"
            name="domain"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder="acme.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "domain-error" : undefined}
          />
        </div>
        <Button type="submit" color="emerald" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Looking it up…
            </>
          ) : (
            <>
              Add domain
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </Button>
      </div>

      {error ? (
        <p id="domain-error" role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          We&apos;ll look up your nameservers, work out who runs your DNS, and give you the exact
          records to add.
        </p>
      )}
    </form>
  );
}
