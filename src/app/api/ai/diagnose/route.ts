import { diagnose, fallbackDiagnosis, recordDiff, type DiagnosisContext } from "@/lib/ai";
import { badRequest, clientIp, json, notFound, rateLimited, readJson, withSession } from "@/lib/api";
import { isUuid, loadOwnedDomain } from "@/lib/domains";
import { latestFound } from "@/lib/verify";

export const dynamic = "force-dynamic";

/**
 * Explain one failed record.
 *
 * The rate limit returns the deterministic fallback rather than an error: a user
 * who has hit the ceiling should still get a usable explanation, just not a
 * freshly generated one.
 */
export async function POST(request: Request) {
  return withSession(async ({ sessionId }) => {
    const body = await readJson<{ domainId?: string; recordId?: string }>(request);

    if (!body?.domainId || !body?.recordId) {
      return badRequest("Tell us which record to look at.");
    }
    if (!isUuid(body.domainId) || !isUuid(body.recordId)) {
      return notFound("We couldn't find that record.");
    }

    const domain = await loadOwnedDomain(body.domainId, sessionId);
    const record = domain?.records.find((r) => r.id === body.recordId);

    if (!domain || !record) {
      return notFound("We couldn't find that record.");
    }

    if (record.status === "verified") {
      return badRequest("That record is already verified.");
    }

    const context: DiagnosisContext = {
      domain: domain.name,
      type: record.type,
      host: record.host,
      expectedValue: record.expected_value,
      found: await latestFound(record.id),
      failureReason:
        record.failure_reason ?? "This record hasn't been checked against live DNS yet.",
      provider: domain.dns_provider ?? "generic",
    };

    const sessionLimited = rateLimited("diagnose", sessionId, "");
    const ipLimited = rateLimited("ai_ip", clientIp(request), "");

    // The diff comes from our own DNS lookup, so it is returned on every path —
    // the user sees what DNS actually holds even when Claude never answers.
    const diff = recordDiff(context);

    if (sessionLimited || ipLimited) {
      return json({
        diagnosis: fallbackDiagnosis(context),
        diff,
        limited: true,
        note: "You've used up this session's AI diagnoses for the hour. Here's the standard fix for this provider in the meantime.",
      });
    }

    return json({ diagnosis: await diagnose(context), diff });
  });
}
