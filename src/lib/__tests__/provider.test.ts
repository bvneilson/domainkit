import { describe, expect, it } from "vitest";
import { PROVIDERS, detectProvider, getProvider, isKnownProvider } from "@/lib/provider";

describe("detectProvider", () => {
  it("recognizes Cloudflare", () => {
    expect(detectProvider(["kim.ns.cloudflare.com.", "walt.ns.cloudflare.com."])).toBe("cloudflare");
  });

  it("recognizes Cloudflare nameservers that lack the usual .ns. infix", () => {
    // Customer zones get names like kim.ns.cloudflare.com, but plenty of zones
    // (including cloudflare.com itself) are served from ns3.cloudflare.com.
    expect(detectProvider(["ns3.cloudflare.com.", "ns4.cloudflare.com."])).toBe("cloudflare");
  });

  it("recognizes GoDaddy", () => {
    expect(detectProvider(["ns01.domaincontrol.com.", "ns02.domaincontrol.com."])).toBe("godaddy");
  });

  it("recognizes GoDaddy's own cns nameservers", () => {
    expect(detectProvider(["cns1.godaddy.com.", "cns2.godaddy.com."])).toBe("godaddy");
  });

  it("recognizes Namecheap", () => {
    expect(detectProvider(["dns1.registrar-servers.com.", "dns2.registrar-servers.com."])).toBe(
      "namecheap",
    );
  });

  it("recognizes Route53 across all four of its TLDs", () => {
    // A single Route 53 zone is served from one nameserver in each TLD, so
    // missing any one of them means a coin-flip on whether detection works.
    expect(detectProvider(["ns-264.awsdns-33.com."])).toBe("route53");
    expect(detectProvider(["ns-521.awsdns-01.net."])).toBe("route53");
    expect(detectProvider(["ns-1447.awsdns-52.org."])).toBe("route53");
    expect(detectProvider(["ns-1707.awsdns-21.co.uk."])).toBe("route53");
  });

  it("recognizes Google", () => {
    expect(detectProvider(["ns-cloud-a1.googledomains.com."])).toBe("google");
    expect(detectProvider(["ns1.google.com."])).toBe("google");
  });

  it("falls back to generic for unrecognized nameservers", () => {
    expect(detectProvider(["ns1.some-tiny-host.net."])).toBe("generic");
  });

  it("falls back to generic when there are no nameservers at all", () => {
    expect(detectProvider([])).toBe("generic");
  });

  it("ignores case and trailing dots", () => {
    expect(detectProvider(["KIM.NS.CLOUDFLARE.COM"])).toBe("cloudflare");
  });

  it("does not match a lookalike domain that merely contains the pattern", () => {
    // A hostname that ends in something else entirely must not be claimed by Cloudflare.
    expect(detectProvider(["ns.cloudflare.com.evil.example."])).toBe("generic");
  });

  it("uses the first recognized nameserver when a domain lists several hosts", () => {
    expect(detectProvider(["ns1.unknown.net.", "kim.ns.cloudflare.com."])).toBe("cloudflare");
  });
});

describe("getProvider", () => {
  it("returns copy for every known provider", () => {
    for (const id of Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]) {
      const provider = getProvider(id);
      expect(provider.label.length, id).toBeGreaterThan(0);
      expect(provider.recordsUrl === null || provider.recordsUrl.startsWith("https://"), id).toBe(true);
      expect(provider.instructions.TXT.length, id).toBeGreaterThan(0);
      expect(provider.instructions.CNAME.length, id).toBeGreaterThan(0);
      expect(provider.instructions.MX.length, id).toBeGreaterThan(0);
    }
  });

  it("names the provider somewhere in each record type's steps, so the copy has an anchor", () => {
    // These steps are shown on their own in the offline fallback diagnosis, where
    // nothing else on screen tells the user which provider they are being given.
    for (const id of Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]) {
      if (id === "generic") continue;
      const provider = getProvider(id);
      // Any distinctive word from the label anchors the copy — "Route 53" is as
      // recognizable to the user as "AWS", and Google's label spans two products.
      const words = provider.label
        .toLowerCase()
        .split(/[\s/]+/)
        .filter((word) => word.length > 2);

      for (const type of ["TXT", "CNAME", "MX"] as const) {
        const steps = provider.instructions[type].join(" ").toLowerCase();
        expect(
          words.some((word) => steps.includes(word)),
          `${id} ${type} never names the provider: ${steps}`,
        ).toBe(true);
      }
    }
  });

  it("falls back to generic copy for an unknown id", () => {
    expect(getProvider("not-a-provider").id).toBe("generic");
  });

  it("tells Cloudflare users to turn the proxy off, which is the classic failure", () => {
    const cloudflare = getProvider("cloudflare");
    const copy = [...cloudflare.instructions.CNAME, ...cloudflare.notes].join(" ").toLowerCase();
    expect(copy).toContain("dns only");
  });

  it("explains the root-domain convention each provider uses", () => {
    expect(getProvider("cloudflare").rootHostLabel).toBe("@");
    expect(getProvider("route53").rootHostLabel).toBe("the domain itself");
  });
});

describe("isKnownProvider", () => {
  it("is true for detected providers and false for the fallback", () => {
    expect(isKnownProvider("cloudflare")).toBe(true);
    expect(isKnownProvider("generic")).toBe(false);
    expect(isKnownProvider("nonsense")).toBe(false);
  });
});
