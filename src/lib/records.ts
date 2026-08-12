import type { DnsResult } from "@/lib/dns";

/**
 * The three records DomainKit asks for, and the rules that decide whether live
 * DNS actually satisfies them.
 *
 * These rules are the product. Everything else — the UI, the AI diagnosis, the
 * chat — is downstream of whether this file gets "is this record correct?" right.
 */

export const CNAME_HOST_PREFIX = "dk1._domainkey";
export const CNAME_TARGET = process.env.DOMAINKIT_DKIM_TARGET ?? "dk1.domainkit.app";
export const MX_TARGET = process.env.DOMAINKIT_MX_TARGET ?? "mx.domainkit.app";
export const MX_PRIORITY = 10;
export const TXT_PREFIX = "domainkit-verify=";

export type DkRecordType = "TXT" | "CNAME" | "MX";
export type RecordStatus = "pending" | "checking" | "verified" | "failed";
export type DomainStatus = "pending" | "checking" | "verified" | "action_needed";

export type GeneratedRecord = {
  type: DkRecordType;
  host: string;
  expected_value: string;
  status: RecordStatus;
  /** What the user types into the provider's Name/Host field, which is rarely the full host. */
  hostLabel: string;
  purpose: string;
};

export type MatchResult = {
  status: RecordStatus;
  /** Null when verified cleanly; otherwise a plain-English description of the gap. */
  reason: string | null;
  /** The values actually present in DNS, normalized for display in the diff. */
  found: string[];
};

/** Generate the three independent records for a freshly added domain. */
export function buildRecords(domain: string, token: string): GeneratedRecord[] {
  return [
    {
      type: "TXT",
      host: domain,
      expected_value: `${TXT_PREFIX}${token}`,
      status: "pending",
      hostLabel: "@",
      purpose: "Proves you control this domain.",
    },
    {
      type: "CNAME",
      host: `${CNAME_HOST_PREFIX}.${domain}`,
      expected_value: CNAME_TARGET,
      status: "pending",
      hostLabel: CNAME_HOST_PREFIX,
      purpose: "Lets us sign your mail with DKIM so it isn't marked as spam.",
    },
    {
      type: "MX",
      host: domain,
      expected_value: MX_TARGET,
      status: "pending",
      hostLabel: "@",
      purpose: "Routes mail for this domain to us.",
    },
  ];
}

/** Hostnames in DNS answers are case-insensitive and carry a trailing root dot. */
export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * A TXT answer is one or more quoted strings. Values longer than 255 bytes are
 * split into several chunks that must be concatenated before comparison, and the
 * quotes are part of the wire format rather than part of the value.
 */
export function parseTxtValue(raw: string): string {
  const chunks = raw.match(/"([^"]*)"/g);
  if (!chunks) {
    return raw.trim();
  }
  return chunks.map((chunk) => chunk.slice(1, -1)).join("");
}

/** How close two strings are, 0..1, used only to tell a typo from a wrong record. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1;

  // Levenshtein distance, single-row.
  let previous = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    const current = [i];
    for (let j = 1; j <= shorter.length; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return 1 - previous[shorter.length] / longer.length;
}

/**
 * Format found values for a failure message.
 *
 * Real domains carry a lot of TXT records — a dozen site-verification strings is
 * normal — and pasting all of them into one sentence buries the actual point. The
 * full list is still stored in verification history and shown in the diff.
 */
function list(values: string[], limit = 3): string {
  const shown = values.slice(0, limit).map((v) => `"${truncate(v)}"`);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Show a value in full, uncut.
 *
 * Used when the message is asking the user to spot the difference between what
 * they typed and what we expected — clipping the tail there would hide exactly
 * the character that's wrong.
 */
function exact(value: string): string {
  return `"${value}"`;
}

function matchTxt(expected: string, found: string[]): MatchResult {
  if (found.some((value) => value === expected)) {
    return { status: "verified", reason: null, found };
  }

  if (found.length === 0) {
    return {
      status: "failed",
      reason:
        "No TXT record was found on this host. Either it hasn't been added yet, or it was added to a different name — check that the host field is set to the root domain.",
      found,
    };
  }

  const ours = found.filter((value) => value.startsWith(TXT_PREFIX));
  if (ours.length > 0) {
    const closest = ours.reduce((best, value) =>
      similarity(value, expected) > similarity(best, expected) ? value : best,
    );
    return {
      status: "failed",
      reason: `A DomainKit TXT record is present but the token doesn't match — it looks like a typo or a value from an older attempt. Found ${exact(closest)} but expected "${expected}".`,
      found,
    };
  }

  const closest = found.reduce((best, value) =>
    similarity(value, expected) > similarity(best, expected) ? value : best,
  );

  if (similarity(closest, expected) > 0.7) {
    return {
      status: "failed",
      reason: `The TXT record on this host is very similar to the expected value but not identical, which almost always means a typo or a truncated copy. Found ${exact(closest)}.`,
      found,
    };
  }

  return {
    status: "failed",
    reason: `This host has ${found.length} TXT record${found.length === 1 ? "" : "s"}, but none of them is the DomainKit verification value. Found ${list(found)}.`,
    found,
  };
}

function matchCname(expected: string, found: string[]): MatchResult {
  const target = normalizeHostname(expected);
  const normalized = found.map(normalizeHostname);

  if (normalized.includes(target)) {
    return { status: "verified", reason: null, found: normalized };
  }

  if (normalized.length === 0) {
    return {
      status: "failed",
      reason:
        "No CNAME record was found on this host. If you added one, check that the host field contains only the subdomain part — many providers append the domain for you.",
      found: normalized,
    };
  }

  return {
    status: "failed",
    reason: `This host has a CNAME, but it points to ${list(normalized)} instead of "${target}".`,
    found: normalized,
  };
}

/**
 * An MX answer is `"<priority> <host>"`.
 *
 * The host may be the DNS root, `.`, which normalises to an empty string. That is
 * a null MX (RFC 7505) rather than a missing value, so it is flagged here instead
 * of being passed on as an empty host nobody can read.
 */
function parseMx(raw: string): { priority: number | null; host: string; isNull: boolean } {
  const match = raw.trim().match(/^(\d+)\s+(\S+)$/);
  if (!match) {
    const host = normalizeHostname(raw);
    return { priority: null, host, isNull: host === "" };
  }
  const host = normalizeHostname(match[2]);
  return { priority: Number(match[1]), host, isNull: host === "" };
}

function matchMx(expected: string, found: string[]): MatchResult {
  const target = normalizeHostname(expected);
  const parsed = found.map(parseMx);
  // A null MX has no hostname to show, so it is written back as the root label it
  // arrived as — an empty string in the diff would tell the user nothing.
  const display = parsed.map((mx) => {
    const host = mx.isNull ? "." : mx.host;
    return mx.priority === null ? host : `${mx.priority} ${host}`;
  });

  const ours = parsed.find((mx) => mx.host === target && !mx.isNull);

  if (ours) {
    // Mail still routes with a different priority, so this is a warning rather
    // than a failure — but it changes delivery order, so we say it out loud.
    if (ours.priority !== MX_PRIORITY) {
      return {
        status: "verified",
        reason: `Verified, but the priority is ${ours.priority ?? "missing"} rather than the recommended ${MX_PRIORITY}. Mail will still route; a lower number is tried first.`,
        found: display,
      };
    }
    return { status: "verified", reason: null, found: display };
  }

  if (parsed.length === 0) {
    return {
      status: "failed",
      reason:
        "No MX record was found on this host. Some providers ignore MX rows until you switch mail settings to a custom configuration.",
      found: display,
    };
  }

  // A null MX is a deliberate "this domain accepts no mail" declaration, and RFC 7505
  // requires it to be the only MX in the set. Describing it as just another mail
  // server would send the user off to add a record that cannot work until it is gone.
  if (parsed.some((mx) => mx.isNull)) {
    return {
      status: "failed",
      reason:
        'This domain publishes a "null MX" (the record 0 .), which tells the internet it accepts no mail at all. Remove that record first — it has to be the only MX on the domain, so ours cannot work alongside it — then add the MX below.',
      found: display,
    };
  }

  return {
    status: "failed",
    reason: `This domain has MX records pointing to ${list(parsed.map((mx) => mx.host))}, but none of them is "${target}". Adding ours does not remove the others — mail can use several servers.`,
    found: display,
  };
}

/**
 * Whether a record's host sits below the domain rather than on it.
 *
 * DomainKit only ever generates one such record — the DKIM CNAME at
 * `dk1._domainkey.<domain>` — so this checks for that prefix rather than trying
 * to count labels, which would need a public-suffix list to get right (a
 * two-label host is a subdomain under `example.com` but the root under
 * `example.co.uk`).
 */
function isSubdomainRecord(host: string): boolean {
  return normalizeHostname(host).startsWith(`${CNAME_HOST_PREFIX}.`);
}

/**
 * Decide whether a single record is satisfied by a single DNS result.
 *
 * Each record is judged entirely on its own. One record failing never changes
 * the verdict on another.
 */
export function matchRecord(
  record: Pick<GeneratedRecord, "type" | "expected_value" | "host">,
  dns: DnsResult,
): MatchResult {
  if (dns.kind === "error") {
    // We learned nothing, so we must not claim the user did anything wrong.
    return { status: "pending", reason: dns.message, found: [] };
  }

  if (dns.kind === "nxdomain") {
    // NXDOMAIN means this exact name is absent from DNS, which means two very
    // different things depending on which name we asked about. On the root it
    // is a real problem — the domain isn't registered or isn't delegated. On a
    // subdomain like dk1._domainkey.<domain> it is simply the state before the
    // user adds the record, which is where everyone starts. Telling that user to
    // check their spelling points them at the one thing that isn't wrong.
    if (isSubdomainRecord(record.host)) {
      return {
        status: "failed",
        reason: `Nothing exists at "${record.host}" yet — this record hasn't been created. Add it at your DNS provider; most providers want only the "${CNAME_HOST_PREFIX}" part in the host field and append the domain for you.`,
        found: [],
      };
    }

    return {
      status: "failed",
      reason:
        "We couldn't find this domain in DNS at all — it doesn't exist as far as the public internet is concerned. Check the spelling, and make sure the domain is registered and pointed at a working nameserver.",
      found: [],
    };
  }

  switch (record.type) {
    case "TXT":
      return matchTxt(record.expected_value, dns.values.map(parseTxtValue));
    case "CNAME":
      return matchCname(record.expected_value, dns.values);
    case "MX":
      return matchMx(record.expected_value, dns.values);
  }
}

/** Roll the independent record statuses up into one status for the domain. */
export function deriveDomainStatus(statuses: RecordStatus[]): DomainStatus {
  if (statuses.length > 0 && statuses.every((s) => s === "verified")) {
    return "verified";
  }
  if (statuses.includes("failed")) {
    return "action_needed";
  }
  if (statuses.includes("checking")) {
    return "checking";
  }
  return "pending";
}
