import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_SYSTEM_PROMPT,
  DIAGNOSE_MODEL,
  MAX_TOKENS,
  buildDiagnosisPrompt,
  chat,
  chatContextBlock,
  diagnose,
  fallbackDiagnosis,
  recordDiff,
  resetAiClientForTests,
} from "@/lib/ai";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("model selection", () => {
  it("uses the Haiku 4.5 alias without a date suffix", () => {
    expect(DIAGNOSE_MODEL).toBe("claude-haiku-4-5");
  });
});

describe("buildDiagnosisPrompt", () => {
  const context = {
    domain: "acme.com",
    type: "TXT" as const,
    host: "acme.com",
    expectedValue: "domainkit-verify=abc123",
    found: ["v=spf1 -all"],
    failureReason: "None of the TXT records match.",
    provider: "cloudflare",
  };

  it("includes everything the model needs to be specific", () => {
    const prompt = buildDiagnosisPrompt(context);
    expect(prompt).toContain("acme.com");
    expect(prompt).toContain("TXT");
    expect(prompt).toContain("domainkit-verify=abc123");
    expect(prompt).toContain("v=spf1 -all");
    expect(prompt).toContain("Cloudflare");
  });

  it("says plainly when nothing was found, rather than showing an empty list", () => {
    const prompt = buildDiagnosisPrompt({ ...context, found: [] });
    expect(prompt).toMatch(/no records|nothing/i);
  });

  it("passes the provider's known gotchas through so the advice is provider-specific", () => {
    const prompt = buildDiagnosisPrompt(context);
    expect(prompt.toLowerCase()).toContain("dns only");
  });
});

describe("fallbackDiagnosis", () => {
  const context = {
    domain: "acme.com",
    type: "CNAME" as const,
    host: "dk1._domainkey.acme.com",
    expectedValue: "dk1.domainkit.app",
    found: ["shopify.myshopify.com"],
    failureReason: "This host has a CNAME, but it points somewhere else.",
    provider: "godaddy",
  };

  it("still produces a usable diagnosis when the AI is unavailable", () => {
    const result = fallbackDiagnosis(context);
    expect(result.diagnosis).toContain("This host has a CNAME");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.severity).toBeTruthy();
  });

  it("uses the detected provider's own instructions in the steps", () => {
    const result = fallbackDiagnosis(context);
    expect(result.steps.join(" ")).toMatch(/godaddy|My Products/i);
  });

  it("marks itself as not AI-generated so the UI can be honest about it", () => {
    expect(fallbackDiagnosis(context).source).toBe("fallback");
  });
});

describe("recordDiff", () => {
  const context = {
    domain: "acme.com",
    type: "TXT" as const,
    host: "acme.com",
    expectedValue: "domainkit-verify=abc123",
    found: ["v=spf1 -all", "google-site-verification=xyz"],
    failureReason: "None of the TXT records match.",
    provider: "cloudflare",
  };

  it("carries the expected and actual values so the UI can show the difference", () => {
    const diff = recordDiff(context);
    expect(diff.type).toBe("TXT");
    expect(diff.host).toBe("acme.com");
    expect(diff.expected).toBe("domainkit-verify=abc123");
    expect(diff.found).toEqual(["v=spf1 -all", "google-site-verification=xyz"]);
  });

  it("reports that nothing was found rather than an empty list the UI must interpret", () => {
    const diff = recordDiff({ ...context, found: [] });
    expect(diff.found).toEqual([]);
    expect(diff.foundNothing).toBe(true);
  });

  it("is not set to foundNothing when records exist but do not match", () => {
    expect(recordDiff(context).foundNothing).toBe(false);
  });
});

describe("diagnose — degradation when Claude is unavailable", () => {
  const context = {
    domain: "acme.com",
    type: "TXT" as const,
    host: "acme.com",
    expectedValue: "domainkit-verify=abc123",
    found: ["v=spf1 -all"],
    failureReason: "None of the TXT records match.",
    provider: "cloudflare",
  };

  beforeEach(() => {
    // The real client is memoised; each test installs its own stub.
    resetAiClientForTests();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAiClientForTests();
  });

  type ParseRequest = { model: string; max_tokens: number };

  function stubParse(impl: (request: ParseRequest) => unknown) {
    const parse = vi.fn(impl);
    resetAiClientForTests({ messages: { parse } } as never);
    return parse;
  }

  it("falls back instead of throwing when the Claude call errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubParse(() => {
      throw new Error("connection reset");
    });

    const result = await diagnose(context);

    expect(result.source).toBe("fallback");
    expect(result.diagnosis).toContain("None of the TXT records match.");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("falls back when the model returns nothing parseable", async () => {
    stubParse(() => ({ parsed_output: null }));

    const result = await diagnose(context);

    expect(result.source).toBe("fallback");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("falls back when the model returns a diagnosis with no steps to follow", async () => {
    stubParse(() => ({
      parsed_output: { diagnosis: "Something is wrong.", steps: [], severity: "easy_fix" },
    }));

    const result = await diagnose(context);

    expect(result.source).toBe("fallback");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("falls back when no API key is configured at all", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const result = await diagnose(context);

    expect(result.source).toBe("fallback");
  });

  it("returns the model's own explanation, tagged as AI, when the call succeeds", async () => {
    stubParse(() => ({
      parsed_output: {
        diagnosis: "Your TXT record is on www instead of the root.",
        steps: ["Open Cloudflare DNS", "Set the name to @"],
        severity: "easy_fix",
      },
    }));

    const result = await diagnose(context);

    expect(result.source).toBe("ai");
    expect(result.diagnosis).toBe("Your TXT record is on www instead of the root.");
    expect(result.steps).toEqual(["Open Cloudflare DNS", "Set the name to @"]);
    expect(result.severity).toBe("easy_fix");
  });

  it("asks Haiku 4.5 with a bounded token budget", async () => {
    const parse = stubParse(() => ({
      parsed_output: { diagnosis: "d", steps: ["s"], severity: "easy_fix" },
    }));

    await diagnose(context);

    const request = parse.mock.calls[0]![0];
    expect(request.model).toBe("claude-haiku-4-5");
    expect(request.max_tokens).toBeLessThanOrEqual(2000);
  });
});

describe("chat system prompt", () => {
  it("scopes the assistant to DNS so the endpoint isn't a free general chatbot", () => {
    expect(CHAT_SYSTEM_PROMPT.toLowerCase()).toContain("dns");
    expect(CHAT_SYSTEM_PROMPT.toLowerCase()).toMatch(/only|decline|refuse|stay/);
  });
});

/**
 * The promise of the help chat is that the user never has to explain their
 * situation: the domain, the detected provider and which records are failing
 * are already in the model's context. These cover that promise directly.
 */
describe("chatContextBlock", () => {
  const context = {
    domain: "acme.com",
    provider: "godaddy",
    records: [
      {
        type: "TXT" as const,
        host: "acme.com",
        expected_value: "domainkit-verify=abc123",
        status: "failed",
        failure_reason: "The TXT record is on www.acme.com, not the root.",
      },
      {
        type: "CNAME" as const,
        host: "dk1._domainkey.acme.com",
        expected_value: "dk1.domainkit.app",
        status: "verified",
        failure_reason: null,
      },
    ],
  };

  it("names the domain the user is actually working on", () => {
    expect(chatContextBlock(context)).toContain("acme.com");
  });

  it("names the detected provider, not the raw id, so the model uses real screen names", () => {
    const block = chatContextBlock(context);
    expect(block).toContain("GoDaddy");
  });

  it("tells the model how this provider writes the root host", () => {
    // GoDaddy uses "@" for the root; the model must not tell a GoDaddy user to
    // type the full domain into the Host field.
    expect(chatContextBlock(context)).toContain("@");
  });

  it("includes every record with its current status", () => {
    const block = chatContextBlock(context);
    expect(block).toContain("TXT");
    expect(block).toContain("failed");
    expect(block).toContain("CNAME");
    expect(block).toContain("verified");
  });

  it("carries the failure reason of a failing record so the answer can be specific", () => {
    expect(chatContextBlock(context)).toContain("The TXT record is on www.acme.com, not the root.");
  });

  it("includes each record's expected value so the model can quote it exactly", () => {
    const block = chatContextBlock(context);
    expect(block).toContain("domainkit-verify=abc123");
    expect(block).toContain("dk1.domainkit.app");
  });

  it("passes the provider's gotchas through", () => {
    // The generic provider has different notes; picking a real one proves the
    // block is provider-sensitive rather than boilerplate.
    const cloudflare = chatContextBlock({ ...context, provider: "cloudflare" });
    expect(cloudflare).toContain("Cloudflare");
    expect(cloudflare).not.toContain("GoDaddy");
  });

  it("falls back to the generic provider rather than breaking on an unknown id", () => {
    const block = chatContextBlock({ ...context, provider: "not-a-real-provider" });
    expect(block).toContain("acme.com");
    expect(block.length).toBeGreaterThan(0);
  });
});

describe("chat", () => {
  const context = {
    domain: "acme.com",
    provider: "cloudflare",
    records: [
      {
        type: "TXT" as const,
        host: "acme.com",
        expected_value: "domainkit-verify=abc123",
        status: "failed",
        failure_reason: "No TXT record found on the root.",
      },
    ],
  };

  function stubClient(create: ReturnType<typeof vi.fn>) {
    resetAiClientForTests({ messages: { create } } as never);
    return create;
  }

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    resetAiClientForTests();
    vi.unstubAllEnvs();
  });

  function textReply(text: string) {
    return { content: [{ type: "text", text }] };
  }

  it("puts the domain, provider and record state in the system prompt", async () => {
    const create = stubClient(vi.fn().mockResolvedValue(textReply("Set Name to @.")));

    await chat(context, [], "Where does the TXT record go?");

    const system: string = create.mock.calls[0]![0].system;
    expect(system).toContain("acme.com");
    expect(system).toContain("Cloudflare");
    expect(system).toContain("No TXT record found on the root.");
  });

  it("keeps the DNS-only guardrail in the system prompt alongside the context", async () => {
    const create = stubClient(vi.fn().mockResolvedValue(textReply("ok")));

    await chat(context, [], "hello");

    expect(create.mock.calls[0]![0].system).toContain(CHAT_SYSTEM_PROMPT);
  });

  it("replays prior turns so the conversation has memory", async () => {
    const create = stubClient(vi.fn().mockResolvedValue(textReply("Yes, still @.")));

    await chat(
      context,
      [
        { role: "user", content: "Where does the TXT record go?" },
        { role: "assistant", content: "Set Name to @." },
      ],
      "Even for the root?",
    );

    expect(create.mock.calls[0]![0].messages).toEqual([
      { role: "user", content: "Where does the TXT record go?" },
      { role: "assistant", content: "Set Name to @." },
      { role: "user", content: "Even for the root?" },
    ]);
  });

  it("asks Haiku 4.5 with a bounded token budget", async () => {
    const create = stubClient(vi.fn().mockResolvedValue(textReply("ok")));

    await chat(context, [], "hi");

    const request = create.mock.calls[0]![0];
    expect(request.model).toBe(DIAGNOSE_MODEL);
    expect(request.max_tokens).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it("returns the model's reply on success", async () => {
    stubClient(vi.fn().mockResolvedValue(textReply("Set the Name field to @.")));

    const result = await chat(context, [], "How?");

    expect(result).toEqual({ ok: true, reply: "Set the Name field to @." });
  });

  it("joins multiple text blocks into one reply", async () => {
    stubClient(
      vi.fn().mockResolvedValue({
        content: [
          { type: "text", text: "First. " },
          { type: "thinking", thinking: "ignored" },
          { type: "text", text: "Second." },
        ],
      }),
    );

    const result = await chat(context, [], "How?");

    expect(result).toEqual({ ok: true, reply: "First. Second." });
  });

  it("degrades without throwing when the Claude call errors", async () => {
    stubClient(vi.fn().mockRejectedValue(new Error("network down")));

    const result = await chat(context, [], "How?");

    expect(result.ok).toBe(false);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("degrades when the model returns an empty reply", async () => {
    stubClient(vi.fn().mockResolvedValue(textReply("   ")));

    const result = await chat(context, [], "How?");

    expect(result.ok).toBe(false);
  });

  it("degrades, rather than calling Claude, when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const create = stubClient(vi.fn());

    const result = await chat(context, [], "How?");

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("still points the user at the non-AI instructions when it degrades", async () => {
    stubClient(vi.fn().mockRejectedValue(new Error("network down")));

    const result = await chat(context, [], "How?");

    // A degraded chat must not imply the whole product is broken: the record
    // instructions and diagnoses are deterministic and still correct.
    expect(result.reply.toLowerCase()).toContain("steps");
  });
});
