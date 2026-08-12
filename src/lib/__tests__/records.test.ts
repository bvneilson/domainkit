import { describe, expect, it } from "vitest";
import {
  CNAME_TARGET,
  MX_PRIORITY,
  MX_TARGET,
  buildRecords,
  matchRecord,
  parseTxtValue,
  normalizeHostname,
  deriveDomainStatus,
} from "@/lib/records";
import type { DnsResult } from "@/lib/dns";

const ok = (values: string[]): DnsResult => ({
  kind: "ok",
  values,
  raw: { Status: 0, Answer: values.map((data) => ({ name: "x.", type: 0, TTL: 1, data })) },
});

describe("buildRecords", () => {
  it("generates the three records the spec requires", () => {
    const records = buildRecords("acme.com", "token-123");

    expect(records.map((r) => r.type)).toEqual(["TXT", "CNAME", "MX"]);

    const [txt, cname, mx] = records;
    expect(txt).toMatchObject({ host: "acme.com", expected_value: "domainkit-verify=token-123" });
    expect(cname).toMatchObject({ host: "dk1._domainkey.acme.com", expected_value: CNAME_TARGET });
    expect(mx).toMatchObject({ host: "acme.com", expected_value: MX_TARGET });
  });

  it("starts every record pending and independent", () => {
    for (const record of buildRecords("acme.com", "t")) {
      expect(record.status).toBe("pending");
    }
  });
});

describe("parseTxtValue", () => {
  it("strips the quotes DNS wraps around TXT strings", () => {
    expect(parseTxtValue('"domainkit-verify=abc"')).toBe("domainkit-verify=abc");
  });

  it("concatenates the chunks of a long TXT record", () => {
    // Values over 255 bytes come back as several quoted strings that must be joined.
    expect(parseTxtValue('"part-one" "part-two"')).toBe("part-onepart-two");
  });

  it("leaves an unquoted value alone", () => {
    expect(parseTxtValue("domainkit-verify=abc")).toBe("domainkit-verify=abc");
  });
});

describe("normalizeHostname", () => {
  it("lowercases and drops the trailing root dot", () => {
    expect(normalizeHostname("DK1.DomainKit.app.")).toBe("dk1.domainkit.app");
  });
});

describe("matchRecord — TXT", () => {
  const record = buildRecords("acme.com", "abc")[0];

  it("verifies an exact match", () => {
    const result = matchRecord(record, ok(['"domainkit-verify=abc"']));
    expect(result.status).toBe("verified");
  });

  it("verifies even when the domain has many unrelated TXT records", () => {
    const result = matchRecord(
      record,
      ok(['"v=spf1 include:_spf.google.com ~all"', '"google-site-verification=xyz"', '"domainkit-verify=abc"']),
    );
    expect(result.status).toBe("verified");
  });

  it("verifies a value split across chunks", () => {
    const result = matchRecord(record, ok(['"domainkit-ver" "ify=abc"']));
    expect(result.status).toBe("verified");
  });

  it("fails on a near-miss token and says so specifically", () => {
    const result = matchRecord(record, ok(['"domainkit-verify=abd"']));
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/similar|almost|typo/i);
  });

  it("shows a near-miss value in full, since the point is to spot the difference", () => {
    const token = "a".repeat(80);
    const long = buildRecords("acme.com", token)[0];
    const wrong = `domainkit-verify=${token.slice(0, -1)}b`;

    const result = matchRecord(long, ok([`"${wrong}"`]));

    expect(result.status).toBe("failed");
    // Truncating here would hide the one character that differs.
    expect(result.reason).toContain(wrong);
    expect(result.reason).toContain(long.expected_value);
  });

  it("fails when no TXT records exist at all", () => {
    const result = matchRecord(record, ok([]));
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/no txt record/i);
  });

  it("does not accept a value that merely contains the token as a substring", () => {
    const result = matchRecord(record, ok(['"prefix-domainkit-verify=abc"']));
    expect(result.status).toBe("failed");
  });

  it("keeps the failure message readable when a domain has a dozen TXT records", () => {
    // discord.com really does carry 11 TXT records. Listing all of them inline
    // buries the point of the sentence.
    const many = Array.from({ length: 11 }, (_, i) => `"google-site-verification=${"x".repeat(40)}${i}"`);
    const result = matchRecord(record, ok(many));

    expect(result.status).toBe("failed");
    expect(result.reason!.length).toBeLessThan(400);
    expect(result.reason).toMatch(/and 8 more/);
    // The full set is still captured for the diff and the AI.
    expect(result.found).toHaveLength(11);
  });

  it("records what it actually found so the UI can show a diff", () => {
    const result = matchRecord(record, ok(['"v=spf1 -all"']));
    expect(result.found).toEqual(["v=spf1 -all"]);
  });
});

describe("matchRecord — CNAME", () => {
  const record = buildRecords("acme.com", "abc")[1];

  it("verifies ignoring the trailing dot and case", () => {
    expect(matchRecord(record, ok(["DK1.DomainKit.app."])).status).toBe("verified");
  });

  it("fails when the CNAME points somewhere else", () => {
    const result = matchRecord(record, ok(["shopify.myshopify.com."]));
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/points to/i);
  });

  it("fails when no CNAME is present", () => {
    const result = matchRecord(record, ok([]));
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/no cname/i);
  });
});

describe("matchRecord — MX", () => {
  const record = buildRecords("acme.com", "abc")[2];

  it("verifies host and priority together", () => {
    const result = matchRecord(record, ok([`${MX_PRIORITY} ${MX_TARGET}.`]));
    expect(result.status).toBe("verified");
  });

  it("verifies among other mail servers", () => {
    const result = matchRecord(record, ok(["1 aspmx.l.google.com.", `${MX_PRIORITY} ${MX_TARGET}.`]));
    expect(result.status).toBe("verified");
  });

  it("verifies with the wrong priority, because mail still routes, but says so", () => {
    const result = matchRecord(record, ok([`50 ${MX_TARGET}.`]));
    expect(result.status).toBe("verified");
    expect(result.reason).toMatch(/priority/i);
  });

  it("fails when only other mail servers are present", () => {
    const result = matchRecord(record, ok(["1 aspmx.l.google.com."]));
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/aspmx\.l\.google\.com/);
  });

  it("fails when no MX records exist", () => {
    expect(matchRecord(record, ok([])).status).toBe("failed");
  });

  // RFC 7505: "0 ." is a null MX — an explicit statement that the domain accepts
  // no mail. Its host is the DNS root, which normalises to an empty string, so the
  // generic "pointing to ..." message renders a meaningless pair of empty quotes.
  it("explains a null MX instead of quoting an empty host", () => {
    const result = matchRecord(record, ok(["0 ."]));
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/accepts no mail|null mx/i);
    expect(result.reason).not.toContain('""');
  });

  it("tells the user to remove the null MX, since it must be the only MX", () => {
    const result = matchRecord(record, ok(["0 ."]));
    expect(result.reason).toMatch(/remove|delete/i);
  });

  it("shows the null MX in the diff rather than an empty value", () => {
    const result = matchRecord(record, ok(["0 ."]));
    expect(result.found).toEqual(["0 ."]);
  });

  it("still verifies when our MX sits alongside a stray null MX", () => {
    const result = matchRecord(record, ok(["0 .", `${MX_PRIORITY} ${MX_TARGET}.`]));
    expect(result.status).toBe("verified");
  });

  it("never quotes an empty host for any MX answer", () => {
    const result = matchRecord(record, ok(["1 aspmx.l.google.com.", "0 ."]));
    expect(result.status).toBe("failed");
    expect(result.reason).not.toContain('""');
  });
});

describe("matchRecord — resolver-level outcomes", () => {
  const record = buildRecords("acme.com", "abc")[0];

  it("treats NXDOMAIN on the root domain as a spelling problem", () => {
    const result = matchRecord(record, { kind: "nxdomain", raw: { Status: 3 } });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/couldn't find this domain|doesn't exist/i);
  });

  it("treats NXDOMAIN on a subdomain as a record that isn't created yet", () => {
    // dk1._domainkey.<domain> genuinely returns NXDOMAIN until the user adds the
    // CNAME — that is the normal starting state, not a misspelled domain. Telling
    // someone to check the spelling of a domain we just resolved nameservers for
    // sends them to fix the one thing that isn't broken.
    const [, cname] = buildRecords("acme.com", "abc");
    const result = matchRecord(cname, { kind: "nxdomain", raw: { Status: 3 } });

    expect(result.status).toBe("failed");
    expect(result.reason).not.toMatch(/spelling/i);
    expect(result.reason).toMatch(/dk1\._domainkey/);
    expect(result.reason).toMatch(/hasn't been created|doesn't exist yet|not been added/i);
  });

  it("leaves the record pending when the resolver itself failed", () => {
    // A resolver outage is not evidence that the user did anything wrong.
    const result = matchRecord(record, { kind: "error", message: "DNS servers are slow." });
    expect(result.status).toBe("pending");
    expect(result.reason).toMatch(/slow/i);
  });
});

describe("deriveDomainStatus", () => {
  it("is verified only when every record is verified", () => {
    expect(deriveDomainStatus(["verified", "verified", "verified"])).toBe("verified");
  });

  it("is action_needed when any record failed, even if others verified", () => {
    expect(deriveDomainStatus(["verified", "failed", "verified"])).toBe("action_needed");
  });

  it("is checking while any record is in flight and none have failed", () => {
    expect(deriveDomainStatus(["verified", "checking", "pending"])).toBe("checking");
  });

  it("is pending when nothing has been set up yet", () => {
    expect(deriveDomainStatus(["pending", "pending", "pending"])).toBe("pending");
  });

  it("prefers action_needed over checking so the user sees the problem", () => {
    expect(deriveDomainStatus(["checking", "failed", "pending"])).toBe("action_needed");
  });
});
