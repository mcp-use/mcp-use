import { describe, expect, it } from "vitest";
import {
  applyClaudeResourceDomain,
  computeClaudeResourceDomain,
  isClaudeClient,
} from "../../../src/server/widgets/protocol-helpers.js";

describe("protocol helpers", () => {
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

    it("computes Claude's hash-based resource domain from ui.domain", () => {
      expect(computeClaudeResourceDomain("https://example.com/mcp")).toBe(
        "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com"
      );
    });

    it("does not hash an already computed Claude domain again", () => {
      const domain = "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com";

      expect(computeClaudeResourceDomain(domain)).toBe(domain);
    });

    it("rewrites only ui.domain for Claude while preserving other metadata", () => {
      const resource = {
        _meta: {
          "mcp-use/propsSchema": { message: { type: "string" } },
          ui: {
            domain: "https://example.com/mcp",
            prefersBorder: true,
            csp: {
              connectDomains: ["https://example.com"],
            },
          },
        },
      };

      applyClaudeResourceDomain(resource, {
        name: "claude-desktop",
        version: "1.0.0",
      });

      expect(resource._meta.ui).toEqual({
        domain: "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com",
        prefersBorder: true,
        csp: {
          connectDomains: ["https://example.com"],
        },
      });
      expect(resource._meta["mcp-use/propsSchema"]).toEqual({
        message: { type: "string" },
      });
    });

    it("leaves non-Claude resource domains unchanged", () => {
      const resource = {
        _meta: {
          ui: {
            domain: "https://example.com/mcp",
          },
        },
      };

      applyClaudeResourceDomain(resource, {
        name: "test-client",
        version: "1.0.0",
      });

      expect(resource._meta.ui.domain).toBe("https://example.com/mcp");
    });
  });
});
