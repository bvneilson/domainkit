export type DomainValidation =
  | { ok: true; domain: string }
  | { ok: false; error: string };

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Best-effort cleanup of what a human actually pastes into a domain field:
 * a full URL, a trailing root dot, mixed case, a stray `www.`.
 */
export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0];
  value = value.split("?")[0];
  value = value.replace(/\.$/, "");

  // Only drop `www.` when something domain-shaped remains, so `www.com` survives.
  if (value.startsWith("www.") && value.slice(4).includes(".")) {
    value = value.slice(4);
  }

  return value;
}

/** RFC 1035 name validation, tightened to what a registrable domain looks like. */
export function validateDomain(input: string): DomainValidation {
  const domain = normalizeDomain(input);

  if (!domain) {
    return { ok: false, error: "Enter a domain name." };
  }

  if (domain.length > 253) {
    return { ok: false, error: "That domain is too long to be real." };
  }

  const labels = domain.split(".");

  if (labels.length < 2) {
    return { ok: false, error: "Enter a full domain, like acme.com." };
  }

  for (const label of labels) {
    if (!label) {
      return { ok: false, error: "That domain has an empty part in it." };
    }
    if (label.length > 63) {
      return { ok: false, error: "One part of that domain is longer than 63 characters." };
    }
    if (!LABEL.test(label)) {
      return {
        ok: false,
        error: "Domains can only use letters, numbers, and hyphens (not at the start or end).",
      };
    }
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || /^[0-9]+$/.test(tld)) {
    return { ok: false, error: "That doesn't end in a valid domain extension." };
  }

  return { ok: true, domain };
}
