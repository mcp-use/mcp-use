import { describe, expect, it } from "vitest";

import {
  applyClaudeResourceDomain,
  computeClaudeResourceDomain,
  isClaudeClient,
} from "../../src/views/claude-domain.js";
import { buildResourceUiMeta } from "../../src/views/wire.js";

describe("Claude resource domains", () => {
  it("detects Claude clients by advertised client name", () => {
    expect(isClaudeClient({ name: "claude-desktop", version: "1.0.0" })).toBe(
      true
    );
    expect(isClaudeClient({ name: "Claude Code", version: "1.0.0" })).toBe(
      true
    );
    expect(isClaudeClient({ name: "test-client", version: "1.0.0" })).toBe(
      false
    );
  });

  it("treats a request without client identity as non-Claude", () => {
    expect(isClaudeClient(undefined)).toBe(false);
    expect(isClaudeClient({})).toBe(false);
  });

  it("computes Claude's hash-based resource domain from ui.domain", async () => {
    await expect(
      computeClaudeResourceDomain("https://example.com/mcp")
    ).resolves.toBe("c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com");
    await expect(
      computeClaudeResourceDomain("https://mcp-scioperi-prod.s15o.it/mcp")
    ).resolves.toBe("a40fd2609d07756f5587f7a2e2c75cf3.claudemcpcontent.com");
  });

  it("does not hash an already computed Claude domain again", async () => {
    const domain = "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com";

    await expect(computeClaudeResourceDomain(domain)).resolves.toBe(domain);
  });

  it("rewrites only ui.domain for Claude while preserving other metadata", async () => {
    const meta = {
      "mcp-use/propsSchema": { message: { type: "string" } },
      ui: {
        domain: "https://example.com/mcp",
        prefersBorder: true,
        csp: {
          connectDomains: ["https://example.com"],
        },
      },
    };

    const applied = await applyClaudeResourceDomain(meta, {
      name: "claude-desktop",
      version: "1.0.0",
    });

    expect(applied["ui"]).toEqual({
      domain: "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com",
      prefersBorder: true,
      csp: {
        connectDomains: ["https://example.com"],
      },
    });
    expect(applied["mcp-use/propsSchema"]).toEqual({
      message: { type: "string" },
    });
    expect(meta.ui.domain).toBe("https://example.com/mcp");
  });

  it("leaves non-Claude resource domains unchanged", async () => {
    const meta = { ui: { domain: "https://example.com/mcp" } };

    const applied = await applyClaudeResourceDomain(meta, {
      name: "test-client",
      version: "1.0.0",
    });

    expect(applied).toBe(meta);
    expect(applied["ui"]).toEqual({ domain: "https://example.com/mcp" });
  });

  it("uses HTTP User-Agent for legacy Claude requests without client info", async () => {
    const meta = { ui: { domain: "https://example.com/mcp" } };

    const applied = await applyClaudeResourceDomain(
      meta,
      {},
      "Claude-User/1.0"
    );

    expect(applied["ui"]).toEqual({
      domain: "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com",
    });
  });

  it("prefers advertised client info over HTTP User-Agent", async () => {
    const meta = { ui: { domain: "https://example.com/mcp" } };

    const applied = await applyClaudeResourceDomain(
      meta,
      { name: "test-client", version: "1.0.0" },
      "Claude-User/1.0"
    );

    expect(applied).toBe(meta);
  });

  it("leaves metadata without an authored domain unchanged for Claude", async () => {
    const meta = { ui: { csp: { connectDomains: [] } } };

    const applied = await applyClaudeResourceDomain(meta, {
      name: "claude-desktop",
      version: "1.0.0",
    });

    expect(applied).toBe(meta);
    expect(applied["ui"]).not.toHaveProperty("domain");
  });
});

describe("UI origin and MCP endpoint identity", () => {
  it("uses the full endpoint for Claude independently of the website origin", async () => {
    const meta = buildResourceUiMeta({ domain: "https://website.example.com" });
    const result = await applyClaudeResourceDomain(
      meta,
      { name: "Claude" },
      undefined,
      "https://example.com/mcp"
    );
    expect(result["ui"]).toMatchObject({
      domain: "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com",
    });
    expect(meta["ui"]).toMatchObject({ domain: "https://website.example.com" });
  });

  it.each(["ChatGPT", "other-client"])(
    "emits an exact origin for %s from a legacy endpoint value",
    async (name) => {
      const meta = buildResourceUiMeta({
        domain: "https://example.com/mcp?legacy=1#fragment",
      });
      const result = await applyClaudeResourceDomain(
        meta,
        { name },
        undefined,
        "https://example.com/mcp"
      );
      expect(result["ui"]).toMatchObject({ domain: "https://example.com" });
      expect(result).not.toHaveProperty("openai/widgetDomain");
    }
  );

  it("preserves explicit computed Claude domains even when an endpoint is available", async () => {
    const domain = "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com";
    const result = await applyClaudeResourceDomain(
      { ui: { domain } },
      { name: "Claude" },
      undefined,
      "https://different.example/mcp"
    );
    expect(result["ui"]).toEqual({ domain });
  });

  it("does not opt an undeclared view into a dedicated domain", async () => {
    const meta = buildResourceUiMeta(undefined);
    expect(
      await applyClaudeResourceDomain(
        meta,
        { name: "Claude" },
        undefined,
        "https://example.com/mcp"
      )
    ).toBe(meta);
    expect(meta["ui"]).not.toHaveProperty("domain");
  });
});
