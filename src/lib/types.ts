import type { Provider } from "@/lib/provider";
import type { DkRecordType, DomainStatus, RecordStatus } from "@/lib/records";

/** The shapes the API returns to the browser. Shared so the client isn't guessing. */

export type ApiRecord = {
  id: string;
  domain_id: string;
  type: DkRecordType;
  host: string;
  expected_value: string;
  status: RecordStatus;
  last_checked_at: string | null;
  failure_reason: string | null;
};

export type ApiDomain = {
  id: string;
  name: string;
  dns_provider: string | null;
  created_at: string;
  status: DomainStatus;
  records: ApiRecord[];
};

export type ApiDiagnosis = {
  diagnosis: string;
  steps: string[];
  severity: "easy_fix" | "needs_attention" | "propagation";
  source: "ai" | "fallback";
};

/** The expected-vs-actual DNS difference, rendered whether or not Claude answered. */
export type ApiRecordDiff = {
  type: DkRecordType;
  host: string;
  expected: string;
  found: string[];
  foundNothing: boolean;
};

export type ApiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type { Provider, DomainStatus, RecordStatus, DkRecordType };
