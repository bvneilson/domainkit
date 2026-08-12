"use client";

import { MessageCircleQuestion, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiChatMessage } from "@/lib/types";

const MAX_LENGTH = 500;

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Slide-out help panel. The server already knows the domain, its provider, and
 * which records are failing, so the user never has to explain their situation.
 */
export function HelpChat({ domainId, domainName }: { domainId: string; domainName: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // A ref rather than state: this only guards the one-time fetch, and putting it
  // in state would make loading the history trigger an extra render pass.
  const loaded = useRef(false);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    fetch(`/api/ai/chat?domainId=${domainId}`)
      .then((response) => (response.ok ? response.json() : { messages: [] }))
      .then((body: { messages: ApiChatMessage[] }) => {
        setTurns(body.messages.map(({ role, content }) => ({ role, content })));
      })
      .catch(() => undefined);
  }, [open, domainId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;

    setDraft("");
    setTurns((current) => [...current, { role: "user", content: message }]);
    setBusy(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId, message }),
      });
      const body = await response.json();
      setTurns((current) => [
        ...current,
        { role: "assistant", content: body.reply ?? body.error ?? "Something went wrong." },
      ]);
    } catch {
      setTurns((current) => [
        ...current,
        { role: "assistant", content: "I couldn't reach the server. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <div className="fixed bottom-6 right-6 z-30">
          <Button
            color="white"
            onClick={() => setOpen(true)}
            className="shadow-lg"
          >
            <MessageCircleQuestion className="size-4" aria-hidden />
            Get help
          </Button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end">
          {/* The backdrop is hidden from assistive tech: the panel's own close
              button is the labelled control, and two buttons sharing a name is
              a worse experience than one. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="flex-1 bg-zinc-950/60 backdrop-blur-sm"
          />

          <aside
            role="dialog"
            aria-label={`Help with ${domainName}`}
            className="dk-slide-in flex w-full max-w-md flex-col border-l border-zinc-950/10 bg-white dark:border-white/10 dark:bg-zinc-900"
          >
            <header className="flex items-center justify-between border-b border-zinc-950/10 px-5 py-4 dark:border-white/10">
              <div>
                <p className="text-sm font-medium text-zinc-950 dark:text-white">DNS help</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Knows about {domainName} and which records are failing
                </p>
              </div>
              <Button plain onClick={() => setOpen(false)} aria-label="Close help">
                <X className="size-4" aria-hidden />
              </Button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {turns.length === 0 && !busy && (
                <div className="rounded-lg border border-zinc-950/10 bg-zinc-950/[0.03] px-4 py-3 dark:border-white/10 dark:bg-zinc-950/40">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Ask anything about setting these records up — for example,{" "}
                    <span className="text-zinc-900 dark:text-zinc-200">
                      &ldquo;where do I put the TXT record in my dashboard?&rdquo;
                    </span>
                  </p>
                </div>
              )}

              {turns.map((turn, index) => (
                <div
                  key={index}
                  className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <p
                    className={
                      turn.role === "user"
                        ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-500/15 px-3.5 py-2 text-sm text-emerald-900 dark:text-emerald-100"
                        : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-950/[0.06] px-3.5 py-2 text-sm text-zinc-800 dark:bg-white/10 dark:text-zinc-200"
                    }
                  >
                    {turn.content}
                  </p>
                </div>
              ))}

              {busy && (
                <div className="flex justify-start">
                  <p className="rounded-2xl rounded-bl-sm bg-zinc-950/[0.06] px-3.5 py-2 text-sm text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                    Thinking…
                  </p>
                </div>
              )}

              <div ref={endRef} />
            </div>

            <form onSubmit={send} className="border-t border-zinc-950/10 px-5 py-4 dark:border-white/10">
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
                  placeholder="How do I fix this in my dashboard?"
                  maxLength={MAX_LENGTH}
                  disabled={busy}
                  aria-label="Your question"
                  autoFocus
                />
                <Button type="submit" color="emerald" disabled={busy || !draft.trim()} aria-label="Send">
                  <Send className="size-4" aria-hidden />
                </Button>
              </div>
              <p className="mt-1.5 text-right text-xs text-zinc-500 dark:text-zinc-400">
                {draft.length}/{MAX_LENGTH}
              </p>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
