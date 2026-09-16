import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { limit, fromEnv } = vi.hoisted(() => ({
  limit: vi.fn(),
  fromEnv: vi.fn(() => ({})),
}));

vi.mock("@upstash/redis", () => ({ Redis: { fromEnv } }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn();
    limit = limit;
  },
}));

let server: typeof import("../src/index.js").default;

async function request(method: string, params: object = {}) {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : body;
  const envelope = JSON.parse(data ?? "{}");
  expect(envelope.error).toBeUndefined();
  return envelope.result;
}

function report() {
  return request("tools/call", {
    name: "generate_report",
    arguments: { values: [10, 20, 30] },
  });
}

beforeEach(async () => {
  vi.resetModules();
  limit.mockReset();
  fromEnv.mockClear();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.stubEnv("MCP_USE_ANONYMIZED_TELEMETRY", "false");
  server = (await import("../src/index.js")).default;
});

afterEach(async () => {
  await server?.close();
  vi.unstubAllEnvs();
});

describe("Upstash tool middleware over MCP", () => {
  it("returns three reports, then a tool error, and resumes when allowed", async () => {
    limit
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, reset: Date.now() + 30_000 })
      .mockResolvedValueOnce({ success: true });

    for (let index = 0; index < 3; index++) {
      const result = await report();
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        count: 3,
        total: 60,
        average: 20,
        minimum: 10,
        maximum: 30,
      });
    }
    const blocked = await report();
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("Rate limit reached");
    expect(blocked.content[0].text).not.toContain('"total"');
    expect((await report()).isError).not.toBe(true);
    expect(limit).toHaveBeenCalledTimes(5);
    expect(limit).toHaveBeenLastCalledWith("generate_report");
    expect(fromEnv).toHaveBeenCalledTimes(1);
  });

  it("does not consume quota when discovering tools", async () => {
    const result = await request("tools/list");
    expect(result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "generate_report"
    );
    expect(limit).not.toHaveBeenCalled();
  });

  it.each(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])(
    "keeps discovery available but blocks execution without %s",
    async (variable) => {
      vi.stubEnv(variable, "");
      expect((await request("tools/list")).tools).toHaveLength(1);
      const result = await report();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Set UPSTASH_REDIS_REST_URL");
      expect(limit).not.toHaveBeenCalled();
    }
  );

  it("rejects Upstash's fail-open timeout result", async () => {
    limit.mockResolvedValue({ success: true, reason: "timeout" });
    const result = await report();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("quota check timed out");
  });

  it("rejects provider failures without disclosing request details", async () => {
    limit.mockRejectedValue(new Error("Authorization: Bearer secret-token"));
    const result = await report();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Could not check the quota");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
