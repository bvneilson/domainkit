import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "@/lib/dns";

function dohResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/x-json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolve", () => {
  it("queries Google DNS-over-HTTPS with the right name and type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      dohResponse({ Status: 0, Answer: [{ name: "acme.com.", type: 16, TTL: 300, data: '"hello"' }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await resolve("acme.com", "TXT");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://dns.google/resolve");
    expect(url.searchParams.get("name")).toBe("acme.com");
    expect(url.searchParams.get("type")).toBe("TXT");
  });

  it("returns the answer values for the requested type only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        dohResponse({
          Status: 0,
          Answer: [
            // A CNAME hop that DNS includes on the way to the answer; not a TXT value.
            { name: "acme.com.", type: 5, TTL: 300, data: "other.example." },
            { name: "acme.com.", type: 16, TTL: 300, data: '"v=spf1 -all"' },
          ],
        }),
      ),
    );

    const result = await resolve("acme.com", "TXT");

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.values).toEqual(['"v=spf1 -all"']);
  });

  it("distinguishes NXDOMAIN from an empty answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dohResponse({ Status: 3 })));
    const missing = await resolve("nope.example", "TXT");
    expect(missing.kind).toBe("nxdomain");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dohResponse({ Status: 0, Answer: [] })));
    const empty = await resolve("acme.com", "TXT");
    expect(empty.kind).toBe("ok");
    expect(empty.kind === "ok" && empty.values).toEqual([]);
  });

  it("treats a missing Answer key as an empty answer, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dohResponse({ Status: 0 })));
    const result = await resolve("acme.com", "MX");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.values).toEqual([]);
  });

  it("retries once on a network failure, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue(dohResponse({ Status: 0, Answer: [{ name: "a.", type: 16, TTL: 1, data: '"ok"' }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolve("acme.com", "TXT");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("ok");
  });

  it("gives up after one retry and reports an error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolve("acme.com", "TXT");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toMatch(/slow/i);
  });

  it("retries on a non-200 response from the resolver", async () => {
    const fetchMock = vi.fn().mockResolvedValue(dohResponse({}, 502));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolve("acme.com", "TXT");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("error");
  });

  it("reports a resolver SERVFAIL as an error rather than an empty answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dohResponse({ Status: 2 })));
    const result = await resolve("acme.com", "TXT");
    expect(result.kind).toBe("error");
  });

  it("keeps the raw response for diagnostics", async () => {
    const payload = { Status: 0, Answer: [{ name: "acme.com.", type: 16, TTL: 300, data: '"x"' }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dohResponse(payload)));

    const result = await resolve("acme.com", "TXT");

    expect(result.kind === "ok" && result.raw).toEqual(payload);
  });
});
