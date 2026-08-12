-- DomainKit (COO build) schema.
--
-- Tables are namespaced `dk_*` because an unrelated build on this same Supabase
-- project already owns the unprefixed `domains` / `domain_records` /
-- `verification_history` / `chat_messages` names and holds live rows there.
-- Column definitions match the design spec exactly; only the names differ.
--
-- RLS is enabled with no policies: every row is unreachable with the anon key.
-- The app reaches these tables exclusively through the service-role key from
-- server-side code, which is the correct posture for a session-cookie app —
-- the server is the only thing that decides which session may see which row.

CREATE TABLE IF NOT EXISTS dk_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  name text NOT NULL,
  dns_provider text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dk_domain_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid REFERENCES dk_domains(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('TXT', 'CNAME', 'MX')),
  host text NOT NULL,
  expected_value text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'checking', 'verified', 'failed')),
  last_checked_at timestamptz,
  failure_reason text
);

CREATE TABLE IF NOT EXISTS dk_verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid REFERENCES dk_domain_records(id) ON DELETE CASCADE,
  checked_at timestamptz DEFAULT now(),
  success boolean NOT NULL,
  raw_response jsonb
);

CREATE TABLE IF NOT EXISTS dk_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid REFERENCES dk_domains(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dk_domains_session ON dk_domains(session_id);
CREATE INDEX IF NOT EXISTS idx_dk_records_domain ON dk_domain_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_dk_history_record ON dk_verification_history(record_id);
CREATE INDEX IF NOT EXISTS idx_dk_chat_domain ON dk_chat_messages(domain_id);

ALTER TABLE dk_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_domain_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_verification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE dk_chat_messages ENABLE ROW LEVEL SECURITY;
