import { describe, it, expect } from "vitest";
import {
  createClientCapabilityChecker,
  supportsApps,
} from "../../../src/server/tools/tool-execution-helpers.js";

const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";
const MCP_UI_MIME = "text/html;profile=mcp-app";

const mcpAppsCaps = {
  extensions: {
    [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME] },
  },
};

describe("createClientCapabilityChecker", () => {
  describe("can()", () => {
    it("returns true for a present top-level capability", () => {
      const checker = createClientCapabilityChecker({ sampling: {} });
      expect(checker.can("sampling")).toBe(true);
    });

    it("returns false for an absent capability", () => {
      const checker = createClientCapabilityChecker({ sampling: {} });
      expect(checker.can("elicitation")).toBe(false);
    });

    it("returns false when capabilities are undefined", () => {
      const checker = createClientCapabilityChecker(undefined);
      expect(checker.can("sampling")).toBe(false);
    });

    it("returns true for extensions key when extensions are present", () => {
      const checker = createClientCapabilityChecker(mcpAppsCaps);
      expect(checker.can("extensions")).toBe(true);
    });
  });

  describe("capabilities()", () => {
    it("returns all capabilities as an object", () => {
      const caps = { sampling: {}, roots: { listChanged: true } };
      const checker = createClientCapabilityChecker(caps);
      expect(checker.capabilities()).toEqual(caps);
    });

    it("returns an empty object when capabilities are undefined", () => {
      const checker = createClientCapabilityChecker(undefined);
      expect(checker.capabilities()).toEqual({});
    });

    it("returns a copy, not the original reference", () => {
      const caps = { sampling: {} };
      const checker = createClientCapabilityChecker(caps);
      const returned = checker.capabilities();
      returned.extra = "mutated";
      // Original caps and next call should be unaffected
      expect(checker.capabilities()).not.toHaveProperty("extra");
    });
  });

  describe("info()", () => {
    it("returns name and version when clientInfo is provided", () => {
      const checker = createClientCapabilityChecker(
        {},
        { name: "claude-desktop", version: "1.2.0" }
      );
      expect(checker.info()).toEqual({
        name: "claude-desktop",
        version: "1.2.0",
      });
    });

    it("returns empty object when clientInfo is undefined", () => {
      const checker = createClientCapabilityChecker({});
      expect(checker.info()).toEqual({});
    });

    it("returns partial info when only name is present", () => {
      const checker = createClientCapabilityChecker({}, { name: "my-client" });
      expect(checker.info().name).toBe("my-client");
      expect(checker.info().version).toBeUndefined();
    });
  });

  describe("extension()", () => {
    it("returns the extension settings when the extension is present", () => {
      const checker = createClientCapabilityChecker(mcpAppsCaps);
      const ext = checker.extension(MCP_UI_EXTENSION);
      expect(ext).toEqual({ mimeTypes: [MCP_UI_MIME] });
    });

    it("returns undefined for an unknown extension id", () => {
      const checker = createClientCapabilityChecker(mcpAppsCaps);
      expect(checker.extension("io.example/unknown")).toBeUndefined();
    });

    it("returns undefined when no extensions are present at all", () => {
      const checker = createClientCapabilityChecker({ sampling: {} });
      expect(checker.extension(MCP_UI_EXTENSION)).toBeUndefined();
    });

    it("returns undefined when capabilities are undefined", () => {
      const checker = createClientCapabilityChecker(undefined);
      expect(checker.extension(MCP_UI_EXTENSION)).toBeUndefined();
    });
  });

  describe("supportsApps()", () => {
    it("returns true when client advertises the MCP Apps extension with the correct MIME type", () => {
      const checker = createClientCapabilityChecker(mcpAppsCaps);
      expect(checker.supportsApps()).toBe(true);
    });

    it("returns false when the extension is absent", () => {
      const checker = createClientCapabilityChecker({ sampling: {} });
      expect(checker.supportsApps()).toBe(false);
    });

    it("returns false when mimeTypes does not include the required MIME type", () => {
      const checker = createClientCapabilityChecker({
        extensions: {
          [MCP_UI_EXTENSION]: { mimeTypes: ["text/plain"] },
        },
      });
      expect(checker.supportsApps()).toBe(false);
    });

    it("returns false when mimeTypes is an empty array", () => {
      const checker = createClientCapabilityChecker({
        extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [] } },
      });
      expect(checker.supportsApps()).toBe(false);
    });

    it("returns false when capabilities are undefined", () => {
      const checker = createClientCapabilityChecker(undefined);
      expect(checker.supportsApps()).toBe(false);
    });

    it("returns true when mimeTypes contains additional MIME types alongside the required one", () => {
      const checker = createClientCapabilityChecker({
        extensions: {
          [MCP_UI_EXTENSION]: { mimeTypes: ["text/plain", MCP_UI_MIME] },
        },
      });
      expect(checker.supportsApps()).toBe(true);
    });
  });
});

describe("supportsApps() — standalone utility", () => {
  it("returns true for full MCP Apps capabilities", () => {
    expect(supportsApps(mcpAppsCaps)).toBe(true);
  });

  it("returns false when extension is absent", () => {
    expect(supportsApps({ sampling: {} })).toBe(false);
  });

  it("returns false when mimeTypes does not include the required MIME", () => {
    expect(
      supportsApps({
        extensions: { [MCP_UI_EXTENSION]: { mimeTypes: ["text/html"] } },
      })
    ).toBe(false);
  });

  it("returns false for undefined capabilities", () => {
    expect(supportsApps(undefined)).toBe(false);
  });

  it("returns false for empty capabilities object", () => {
    expect(supportsApps({})).toBe(false);
  });

  it("agrees with createClientCapabilityChecker.supportsApps() in all cases", () => {
    const cases = [
      mcpAppsCaps,
      { sampling: {} },
      { extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [] } } },
      undefined,
      {},
    ];
    for (const caps of cases) {
      const checker = createClientCapabilityChecker(caps);
      expect(checker.supportsApps()).toBe(supportsApps(caps));
    }
  });
});
