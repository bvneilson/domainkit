import { chat, type ChatTurn } from "@/lib/ai";
import { badRequest, clientIp, json, notFound, rateLimited, readJson, withSession } from "@/lib/api";
import { isUuid, loadOwnedDomain } from "@/lib/domains";
import { TABLES, supabase, type DkChatMessage } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const MAX_MESSAGE_LENGTH = 500;
/** How much history to send back to the model; the rest stays in the database. */
const HISTORY_TURNS = 12;

/** Load this domain's chat history. */
export async function GET(request: Request) {
  return withSession(async ({ sessionId }) => {
    const domainId = new URL(request.url).searchParams.get("domainId");

    if (!domainId || !isUuid(domainId)) {
      return notFound("We couldn't find that domain.");
    }

    const domain = await loadOwnedDomain(domainId, sessionId);
    if (!domain) {
      return notFound("We couldn't find that domain.");
    }

    const { data } = await supabase()
      .from(TABLES.chat)
      .select("*")
      .eq("domain_id", domain.id)
      .order("created_at", { ascending: true });

    return json({ messages: (data ?? []) as DkChatMessage[] });
  });
}

/** Answer one help-chat question, with the domain's live record state as context. */
export async function POST(request: Request) {
  return withSession(async ({ sessionId }) => {
    const body = await readJson<{ domainId?: string; message?: string }>(request);
    const message = body?.message?.trim();

    if (!body?.domainId || !message) {
      return badRequest("Type a question first.");
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return badRequest(`Keep questions under ${MAX_MESSAGE_LENGTH} characters.`);
    }
    if (!isUuid(body.domainId)) {
      return notFound("We couldn't find that domain.");
    }

    const domain = await loadOwnedDomain(body.domainId, sessionId);
    if (!domain) {
      return notFound("We couldn't find that domain.");
    }

    const limited =
      rateLimited(
        "chat",
        sessionId,
        "You've asked a lot of questions! Try again in a few minutes.",
      ) ?? rateLimited("ai_ip", clientIp(request), "The assistant is busy. Try again shortly.");

    if (limited) {
      return limited;
    }

    const db = supabase();

    const { data: stored } = await db
      .from(TABLES.chat)
      .select("*")
      .eq("domain_id", domain.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS);

    const history: ChatTurn[] = ((stored ?? []) as DkChatMessage[])
      .reverse()
      .map(({ role, content }) => ({ role, content }));

    const result = await chat(
      {
        domain: domain.name,
        provider: domain.dns_provider ?? "generic",
        records: domain.records.map(({ type, host, expected_value, status, failure_reason }) => ({
          type,
          host,
          expected_value,
          status,
          failure_reason,
        })),
      },
      history,
      message,
    );

    // Only persist an exchange that actually happened. Writing an error string
    // as an assistant turn would poison the context of every later question.
    if (result.ok) {
      await db.from(TABLES.chat).insert([
        { domain_id: domain.id, role: "user", content: message },
        { domain_id: domain.id, role: "assistant", content: result.reply },
      ]);
    }

    return json({ reply: result.reply, persisted: result.ok });
  });
}
