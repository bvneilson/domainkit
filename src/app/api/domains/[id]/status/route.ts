import { json, notFound, withSession } from "@/lib/api";
import { isUuid, loadOwnedDomain } from "@/lib/domains";
import { getProvider } from "@/lib/provider";

export const dynamic = "force-dynamic";

/** The current per-record status, without re-running any DNS lookups. */
export async function GET(_request: Request, ctx: RouteContext<"/api/domains/[id]/status">) {
  return withSession(async ({ sessionId }) => {
    const { id } = await ctx.params;

    if (!isUuid(id)) {
      return notFound("We couldn't find that domain.");
    }

    const domain = await loadOwnedDomain(id, sessionId);
    if (!domain) {
      return notFound("We couldn't find that domain.");
    }

    return json({
      domain: { id: domain.id, name: domain.name, dns_provider: domain.dns_provider },
      status: domain.status,
      records: domain.records,
      provider: getProvider(domain.dns_provider ?? "generic"),
    });
  });
}
