import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DkRecordType, RecordStatus } from "@/lib/records";

/**
 * Server-only Supabase access.
 *
 * The `dk_*` tables have RLS enabled with no policies, so the anon key cannot
 * read or write a single row. Everything goes through the service-role key from
 * server code, which means the server — not the browser — decides which session
 * may see which row. `server-only` makes an accidental client import a build
 * error rather than a leaked key.
 */

export type DkDomain = {
  id: string;
  session_id: string;
  name: string;
  dns_provider: string | null;
  created_at: string;
};

export type DkDomainRecord = {
  id: string;
  domain_id: string;
  type: DkRecordType;
  host: string;
  expected_value: string;
  status: RecordStatus;
  last_checked_at: string | null;
  failure_reason: string | null;
};

export type DkVerificationHistory = {
  id: string;
  record_id: string;
  checked_at: string;
  success: boolean;
  raw_response: unknown;
};

export type DkChatMessage = {
  id: string;
  domain_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

export const TABLES = {
  domains: "dk_domains",
  records: "dk_domain_records",
  history: "dk_verification_history",
  chat: "dk_chat_messages",
} as const;
