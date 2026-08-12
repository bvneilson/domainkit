import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getProvider } from "@/lib/provider";
import type { DkRecordType } from "@/lib/records";

/**
 * Claude Haiku 4.5 turns a raw DNS mismatch into an explanation a non-expert can
 * act on. It is an enhancement on a failure view that already works: every code
 * path here has a deterministic fallback, because a Claude outage must never
 * leave a user staring at a failure with no explanation.
 */

export const DIAGNOSE_MODEL = "claude-haiku-4-5";
export const MAX_TOKENS = 2000;

export const CHAT_SYSTEM_PROMPT = [
  "You are a DNS setup expert helping a user configure domain records for email.",
  "Be specific to the user's DNS provider — name the actual screens and field labels they will see.",
  "Keep answers short and actionable: a few sentences, or a short numbered list.",
  "Only answer questions about DNS, domains, and email deliverability. If asked about anything else,",
  "say that you can only help with DNS setup and steer the conversation back to the user's domain.",
].join(" ");

const DiagnosisSchema = z.object({
  diagnosis: z
    .string()
    .describe(
      "One or two sentences naming the specific mistake, in plain English, addressed to the user as 'you'. No jargon without explaining it.",
    ),
  steps: z
    .array(z.string())
    .describe(
      "Ordered, concrete steps to fix it in this exact DNS provider's interface, naming the real screens and fields.",
    ),
  severity: z
    .enum(["easy_fix", "needs_attention", "propagation"])
    .describe(
      "easy_fix when the user can correct it in under a minute, propagation when the record looks right and just needs time, needs_attention otherwise.",
    ),
});

export type Diagnosis = z.infer<typeof DiagnosisSchema> & { source: "ai" | "fallback" };

export type DiagnosisContext = {
  domain: string;
  type: DkRecordType;
  host: string;
  expectedValue: string;
  found: string[];
  failureReason: string;
  provider: string;
};

export function buildDiagnosisPrompt(context: DiagnosisContext): string {
  const provider = getProvider(context.provider);
  const found =
    context.found.length > 0
      ? context.found.map((value) => `  - ${value}`).join("\n")
      : "  (no records of this type were found on this host at all)";

  return [
    `A user is verifying the domain "${context.domain}" and one DNS record is not matching.`,
    "",
    `Record type: ${context.type}`,
    `Expected host: ${context.host}`,
    `Expected value: ${context.expectedValue}`,
    "Actual DNS response:",
    found,
    "",
    `Their DNS provider: ${provider.label}`,
    `At this provider, the root of the domain is written as: ${provider.rootHostLabel}`,
    `Known gotchas at this provider: ${provider.notes.join(" ")}`,
    "",
    `Our own check said: ${context.failureReason}`,
    "",
    "Work out the single most likely reason this record does not match, and how to fix it.",
    "Common causes are: the record was added to a subdomain such as www instead of the root;",
    "the value has a typo or was truncated when pasted; the wrong record type was used;",
    "the change is correct but has not propagated yet; a CDN proxy is intercepting the record;",
    "or there are several conflicting records on the same host.",
    "Be specific to what you actually see in the DNS response above — do not guess a cause the data contradicts.",
  ].join("\n");
}

/**
 * A deterministic diagnosis built from our own match result and the provider's
 * instruction copy. Used whenever Claude is unavailable, rate limited, or
 * returns something unparseable.
 */
export function fallbackDiagnosis(context: DiagnosisContext): Diagnosis {
  const provider = getProvider(context.provider);
  return {
    diagnosis: context.failureReason,
    steps: [
      ...provider.instructions[context.type],
      `Double-check the value matches exactly: ${context.expectedValue}`,
      "Then run the check again. DNS changes usually appear within 5–15 minutes.",
    ],
    severity: context.found.length === 0 ? "propagation" : "needs_attention",
    source: "fallback",
  };
}

/**
 * The expected-versus-actual DNS difference, independent of the model.
 *
 * This is what the failure view falls back to: it is derived entirely from our
 * own lookup, so it renders whether or not Claude answered.
 */
export type RecordDiff = {
  type: DkRecordType;
  host: string;
  expected: string;
  found: string[];
  foundNothing: boolean;
};

export function recordDiff(context: DiagnosisContext): RecordDiff {
  return {
    type: context.type,
    host: context.host,
    expected: context.expectedValue,
    found: context.found,
    foundNothing: context.found.length === 0,
  };
}

let anthropic: Anthropic | null = null;

function client(): Anthropic {
  if (!anthropic) {
    // Reads ANTHROPIC_API_KEY from the environment; never hard-code the key.
    anthropic = new Anthropic();
  }
  return anthropic;
}

/**
 * Swap the memoised client so tests can drive the failure paths without a
 * network call. Called with no argument it clears the memo.
 */
export function resetAiClientForTests(stub?: Anthropic): void {
  anthropic = stub ?? null;
}

function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Diagnose one failed record. Never throws — returns the fallback instead. */
export async function diagnose(context: DiagnosisContext): Promise<Diagnosis> {
  if (!isConfigured()) {
    return fallbackDiagnosis(context);
  }

  try {
    const response = await client().messages.parse({
      model: DIAGNOSE_MODEL,
      max_tokens: MAX_TOKENS,
      system:
        "You are a DNS expert who explains failures to people who have never edited a DNS record before. Be concrete and never condescending.",
      messages: [{ role: "user", content: buildDiagnosisPrompt(context) }],
      output_config: { format: zodOutputFormat(DiagnosisSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed || parsed.steps.length === 0) {
      return fallbackDiagnosis(context);
    }

    return { ...parsed, source: "ai" };
  } catch (error) {
    logAiError("diagnose", error);
    return fallbackDiagnosis(context);
  }
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatContext = {
  domain: string;
  provider: string;
  records: { type: DkRecordType; host: string; expected_value: string; status: string; failure_reason: string | null }[];
};

/**
 * The block of situational fact prepended to the chat system prompt.
 *
 * Exported so it can be tested directly: that the domain, the detected
 * provider and each record's live status reach the model is the whole promise
 * of the help chat, and it should not rest on an unread code path.
 */
export function chatContextBlock(context: ChatContext): string {
  const provider = getProvider(context.provider);
  const records = context.records
    .map((record) => {
      const failure = record.failure_reason ? ` — ${record.failure_reason}` : "";
      return `  - ${record.type} on ${record.host}, expected "${record.expected_value}", currently ${record.status}${failure}`;
    })
    .join("\n");

  return [
    `The user is setting up the domain "${context.domain}".`,
    `Their DNS provider is ${provider.label}. At this provider the root domain is written as ${provider.rootHostLabel}.`,
    "Their records right now:",
    records,
    `Provider gotchas worth mentioning if relevant: ${provider.notes.join(" ")}`,
  ].join("\n");
}

export type ChatResult =
  | { ok: true; reply: string }
  | { ok: false; reply: string };

/** Answer one help-chat message. Never throws — degrades to a plain apology. */
export async function chat(
  context: ChatContext,
  history: ChatTurn[],
  message: string,
): Promise<ChatResult> {
  if (!isConfigured()) {
    return {
      ok: false,
      reply:
        "The help chat isn't available right now, but the setup steps and the diagnosis on each record are still accurate — they don't depend on AI.",
    };
  }

  try {
    const response = await client().messages.create({
      model: DIAGNOSE_MODEL,
      max_tokens: MAX_TOKENS,
      system: `${CHAT_SYSTEM_PROMPT}\n\n${chatContextBlock(context)}`,
      messages: [...history, { role: "user" as const, content: message }],
    });

    const reply = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!reply) {
      return { ok: false, reply: "I didn't manage to answer that one. Try rephrasing it?" };
    }

    return { ok: true, reply };
  } catch (error) {
    logAiError("chat", error);

    if (error instanceof Anthropic.RateLimitError) {
      return {
        ok: false,
        reply: "The assistant is busy right now. Give it a few seconds and ask again.",
      };
    }

    return {
      ok: false,
      reply:
        "I couldn't reach the assistant just now. The setup steps on each record are still accurate — they don't depend on AI.",
    };
  }
}

function logAiError(surface: string, error: unknown): void {
  if (error instanceof Anthropic.APIError) {
    console.error(`[ai:${surface}] ${error.status} ${error.name}: ${error.message}`);
    return;
  }
  console.error(`[ai:${surface}]`, error);
}
