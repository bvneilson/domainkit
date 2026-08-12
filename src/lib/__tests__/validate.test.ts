import { describe, expect, it } from "vitest";
import { normalizeDomain, validateDomain } from "@/lib/validate";

describe("normalizeDomain", () => {
  it("lowercases and trims", () => {
    expect(normalizeDomain("  ACME.com ")).toBe("acme.com");
  });

  it("strips a scheme and any path", () => {
    expect(normalizeDomain("https://acme.com/pricing")).toBe("acme.com");
    expect(normalizeDomain("http://acme.com")).toBe("acme.com");
  });

  it("strips a trailing root dot", () => {
    expect(normalizeDomain("acme.com.")).toBe("acme.com");
  });

  it("strips a leading www. only when the remainder is still a domain", () => {
    expect(normalizeDomain("www.acme.com")).toBe("acme.com");
    expect(normalizeDomain("www.com")).toBe("www.com");
  });
});

describe("validateDomain", () => {
  it("accepts ordinary domains", () => {
    for (const d of ["acme.com", "sub.acme.com", "a-b.co.uk", "x.io", "123.com"]) {
      expect(validateDomain(d).ok, d).toBe(true);
    }
  });

  it("requires at least one dot", () => {
    const result = validateDomain("localhost");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/like acme\.com/i);
  });

  it("rejects empty input", () => {
    expect(validateDomain("").ok).toBe(false);
    expect(validateDomain("   ").ok).toBe(false);
  });

  it("rejects labels that start or end with a hyphen", () => {
    expect(validateDomain("-acme.com").ok).toBe(false);
    expect(validateDomain("acme-.com").ok).toBe(false);
  });

  it("rejects labels longer than 63 characters", () => {
    expect(validateDomain(`${"a".repeat(64)}.com`).ok).toBe(false);
    expect(validateDomain(`${"a".repeat(63)}.com`).ok).toBe(true);
  });

  it("rejects names longer than 253 characters", () => {
    const label = "a".repeat(63);
    expect(validateDomain(`${label}.${label}.${label}.${label}.com`).ok).toBe(false);
  });

  it("rejects a numeric-only TLD", () => {
    expect(validateDomain("acme.123").ok).toBe(false);
  });

  it("rejects a single-character TLD", () => {
    expect(validateDomain("acme.c").ok).toBe(false);
  });

  it("rejects illegal characters", () => {
    for (const d of ["acme com", "acme_.com", "acme!.com", "acme..com"]) {
      expect(validateDomain(d).ok, d).toBe(false);
    }
  });

  it("returns the normalized domain on success", () => {
    const result = validateDomain(" HTTPS://WWW.Acme.com/ ");
    expect(result.ok && result.domain).toBe("acme.com");
  });
});
