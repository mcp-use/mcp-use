import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OriginResolver,
  parseAllowedOrigin,
  matcherMatchesHostname,
  parseCacheControl,
} from "../../../src/server/utils/origin-resolver.js";

const ENV_KEYS = [
  "MCP_ALLOWED_ORIGINS",
  "MCP_ALLOWED_ORIGINS_URL",
  "MCP_ALLOWED_ORIGINS_TOKEN",
  "MCP_ALLOWED_ORIGINS_WEBHOOK_SECRET",
] as const;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function makeRequest(host: string, url = `http://${host}/mcp`): Request {
  return new Request(url, { headers: { Host: host } });
}

describe("parseAllowedOrigin", () => {
  it("parses literal origins with scheme", () => {
    const m = parseAllowedOrigin("https://app.example.com");
    expect(m).toMatchObject({
      kind: "literal",
      hostname: "app.example.com",
      scheme: "https",
    });
  });

  it("parses literal hostnames without scheme", () => {
    const m = parseAllowedOrigin("app.example.com");
    expect(m).toMatchObject({
      kind: "literal",
      hostname: "app.example.com",
      scheme: undefined,
    });
  });

  it("parses wildcard origins", () => {
    const m = parseAllowedOrigin("https://*.preview.example.com");
    expect(m).toMatchObject({
      kind: "wildcard",
      hostname: "*.preview.example.com",
      scheme: "https",
    });
  });

  it("rejects bare *", () => {
    expect(parseAllowedOrigin("*")).toBeNull();
  });

  it("rejects multiple wildcards", () => {
    expect(parseAllowedOrigin("*.*.example.com")).toBeNull();
  });

  it("rejects wildcards with single-label suffix", () => {
    // "*.com" is a TLD-only wildcard — rejected to prevent foot-guns.
    expect(parseAllowedOrigin("*.com")).toBeNull();
  });
});

describe("matcherMatchesHostname", () => {
  it("literal matcher matches exact hostname (case-insensitive)", () => {
    const m = parseAllowedOrigin("https://App.Example.COM")!;
    expect(matcherMatchesHostname(m, "app.example.com")).toBe(true);
    expect(matcherMatchesHostname(m, "other.example.com")).toBe(false);
  });

  it("wildcard matches exactly one label", () => {
    const m = parseAllowedOrigin("https://*.example.com")!;
    expect(matcherMatchesHostname(m, "a.example.com")).toBe(true);
    expect(matcherMatchesHostname(m, "foo.example.com")).toBe(true);
    // Two labels rejected.
    expect(matcherMatchesHostname(m, "a.b.example.com")).toBe(false);
    // Bare apex rejected.
    expect(matcherMatchesHostname(m, "example.com")).toBe(false);
    // Totally different domain rejected.
    expect(matcherMatchesHostname(m, "evil.com")).toBe(false);
  });
});

describe("parseCacheControl", () => {
  it("parses max-age and stale-while-revalidate", () => {
    const cc = parseCacheControl(
      "public, max-age=10, stale-while-revalidate=60"
    );
    expect(cc.maxAgeSeconds).toBe(10);
    expect(cc.staleWhileRevalidateSeconds).toBe(60);
    expect(cc.noStore).toBe(false);
  });

  it("s-maxage wins over max-age", () => {
    const cc = parseCacheControl("max-age=10, s-maxage=30");
    expect(cc.maxAgeSeconds).toBe(30);
  });

  it("handles no-store / no-cache / must-revalidate", () => {
    const cc = parseCacheControl("no-cache, no-store, must-revalidate");
    expect(cc.noStore).toBe(true);
    expect(cc.noCache).toBe(true);
    expect(cc.mustRevalidate).toBe(true);
  });
});

describe("OriginResolver — static sources", () => {
  beforeEach(() => clearEnv());
  afterEach(() => clearEnv());

  it("reports disabled when nothing is configured", () => {
    const r = new OriginResolver(undefined);
    expect(r.isEnabled()).toBe(false);
    expect(r.getMatchersSync()).toHaveLength(0);
  });

  it("enables with a plain string[] list", () => {
    const r = new OriginResolver(["https://a.com", "https://*.b.com"]);
    expect(r.isEnabled()).toBe(true);
    expect(r.isDynamic()).toBe(false);
    expect(r.matchesHostname("a.com")).toBe(true);
    expect(r.matchesHostname("x.b.com")).toBe(true);
    expect(r.matchesHostname("evil.com")).toBe(false);
  });

  it("merges MCP_ALLOWED_ORIGINS env var with constructor list", () => {
    process.env.MCP_ALLOWED_ORIGINS = "https://c.com, https://d.com";
    const r = new OriginResolver(["https://a.com"]);
    expect(r.matchesHostname("a.com")).toBe(true);
    expect(r.matchesHostname("c.com")).toBe(true);
    expect(r.matchesHostname("d.com")).toBe(true);
  });

  it("dedupes origin strings", () => {
    const r = new OriginResolver([
      "https://a.com",
      "https://a.com",
      "https://b.com",
    ]);
    expect(r.getAllowedOriginStringsSync()).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("treats webhookSecret as opting into dynamic mode", () => {
    const r = new OriginResolver({
      origins: ["https://a.com"],
      webhookSecret: "whsec",
    });
    expect(r.isEnabled()).toBe(true);
    expect(r.isDynamic()).toBe(true);
    expect(r.hasWebhook()).toBe(true);
  });
});

describe("OriginResolver — resolveRequest", () => {
  it("returns fallback origin when resolver is disabled", () => {
    const r = new OriginResolver(undefined, {
      fallbackOrigin: "http://localhost:3000",
    });
    const result = r.resolveRequest(makeRequest("anything.com"));
    expect(result.isAllowed).toBe(false);
    expect(result.origin).toBe("http://localhost:3000");
  });

  it("returns request origin when Host is allow-listed", () => {
    const r = new OriginResolver(["https://app.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const req = new Request("https://app.example.com/mcp", {
      headers: { Host: "app.example.com" },
    });
    const result = r.resolveRequest(req);
    expect(result.isAllowed).toBe(true);
    expect(result.origin).toBe("https://app.example.com");
  });

  it("matches wildcard Host", () => {
    const r = new OriginResolver(["https://*.preview.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const req = new Request("https://pr-42.preview.example.com/mcp", {
      headers: { Host: "pr-42.preview.example.com" },
    });
    const result = r.resolveRequest(req);
    expect(result.isAllowed).toBe(true);
    expect(result.origin).toBe("https://pr-42.preview.example.com");
  });

  it("falls back when Host not allow-listed", () => {
    const r = new OriginResolver(["https://app.example.com"], {
      fallbackOrigin: "http://localhost:3000",
    });
    const result = r.resolveRequest(makeRequest("evil.com"));
    expect(result.isAllowed).toBe(false);
    expect(result.origin).toBe("http://localhost:3000");
  });
});

describe("OriginResolver — providerUrl with HTTP validators", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearEnv();
    fetchMock = vi.fn();
    // @ts-expect-error override global for test
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches once and honors 304 Not Modified on revalidation", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(["https://provider-origin.example.com"]), {
          status: 200,
          headers: {
            ETag: '"v1"',
            "Cache-Control": "public, max-age=0",
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: { ETag: '"v1"' },
        })
      );

    const r = new OriginResolver({
      origins: ["https://static.example.com"],
      providerUrl: "https://config.example/origins.json",
    });

    await r.init();
    expect(r.matchesHostname("provider-origin.example.com")).toBe(true);
    expect(r.matchesHostname("static.example.com")).toBe(true);

    // Trigger revalidation (cache expired, so refreshIfStale kicks off).
    await r.refreshIfStale();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Assert If-None-Match was sent on the 2nd call.
    const secondCall = fetchMock.mock.calls[1];
    const sentHeaders = secondCall[1]?.headers as Record<string, string>;
    expect(sentHeaders["If-None-Match"]).toBe('"v1"');

    // List is still present after 304.
    expect(r.matchesHostname("provider-origin.example.com")).toBe(true);
  });

  it("keeps last-known-good list when provider fails after initial success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(["https://dyn.example.com"]), {
          status: 200,
          headers: {
            ETag: '"v1"',
            "Cache-Control": "public, max-age=0",
            "Content-Type": "application/json",
          },
        })
      )
      .mockRejectedValueOnce(new Error("network down"));

    const r = new OriginResolver({
      providerUrl: "https://config.example/origins.json",
    });
    await r.init();
    expect(r.matchesHostname("dyn.example.com")).toBe(true);

    await r.refreshIfStale();
    // After the failure, the list is still present.
    expect(r.matchesHostname("dyn.example.com")).toBe(true);
    expect(r.isColdStartFailure()).toBe(false);
    warn.mockRestore();
  });

  it("marks cold-start failure when initial fetch fails and no static list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("provider unreachable"));

    const r = new OriginResolver({
      providerUrl: "https://config.example/origins.json",
    });
    await r.init();
    expect(r.isColdStartFailure()).toBe(true);
    warn.mockRestore();
  });

  it("single-flight: concurrent refreshes share one in-flight fetch", async () => {
    let resolveFirst!: (res: Response) => void;
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    fetchMock.mockReturnValueOnce(firstPromise);

    const r = new OriginResolver({
      providerUrl: "https://config.example/origins.json",
    });
    const p1 = r.refreshIfStale();
    const p2 = r.refreshIfStale();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(
      new Response(JSON.stringify(["https://a.example.com"]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.matchesHostname("a.example.com")).toBe(true);
  });
});

describe("OriginResolver — webhook HMAC", () => {
  beforeEach(() => clearEnv());

  function sign(secret: string, t: number, body: string): string {
    return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  }

  it("accepts valid HMAC and swaps in inline origins", async () => {
    const r = new OriginResolver({
      origins: ["https://a.com"],
      webhookSecret: "whsec_test",
    });
    const body = JSON.stringify({ origins: ["https://added.example.com"] });
    const t = Math.floor(Date.now() / 1000);
    const v1 = sign("whsec_test", t, body);

    const result = await r.handleWebhook({
      signatureHeader: `t=${t},v1=${v1}`,
      rawBody: body,
    });

    expect(result.status).toBe(204);
    expect(r.matchesHostname("added.example.com")).toBe(true);
    expect(r.matchesHostname("a.com")).toBe(true); // static still present
  });

  it("rejects bad signature with 401", async () => {
    const r = new OriginResolver({
      webhookSecret: "whsec_test",
    });
    const result = await r.handleWebhook({
      signatureHeader: "t=1,v1=deadbeef",
      rawBody: "{}",
    });
    expect(result.status).toBe(401);
  });

  it("rejects stale timestamp with 401", async () => {
    const r = new OriginResolver({ webhookSecret: "whsec_test" });
    const staleT = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min old
    const body = "{}";
    const v1 = sign("whsec_test", staleT, body);
    const result = await r.handleWebhook({
      signatureHeader: `t=${staleT},v1=${v1}`,
      rawBody: body,
    });
    expect(result.status).toBe(401);
    expect(result.body).toContain("stale");
  });

  it("returns 404 when webhook is not configured", async () => {
    const r = new OriginResolver({ origins: ["https://a.com"] });
    const result = await r.handleWebhook({
      signatureHeader: "t=1,v1=x",
      rawBody: "",
    });
    expect(result.status).toBe(404);
  });
});
