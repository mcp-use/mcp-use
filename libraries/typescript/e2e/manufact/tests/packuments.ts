// npm packuments shared by the published-source tests, as the registry serves
// them (trimmed to the fields resolveCanary reads).

export const SDK_PINS = {
  "@modelcontextprotocol/client": "2.3.1",
  "@modelcontextprotocol/core": "2.3.1",
  "@modelcontextprotocol/server": "2.3.1",
};

export const PACKUMENTS: Record<string, object> = {
  "mcp-use": {
    "dist-tags": { latest: "2.12.10", canary: "2.12.10-canary.2" },
    versions: {
      "2.12.10-canary.2": {
        dependencies: {
          ...SDK_PINS,
          "@mcp-use/cli": "5.4.1-canary.1",
          "@mcp-use/inspector": "20.3.34-canary.0",
          hono: "^4.13.7",
        },
        dist: { integrity: "sha512-mcpuse" },
      },
    },
  },
  "@mcp-use/client": {
    "dist-tags": { canary: "2.4.7-canary.0" },
    versions: { "2.4.7-canary.0": { dist: { integrity: "sha512-client" } } },
  },
  "@mcp-use/cli": {
    // A newer canary than the one mcp-use was published with.
    "dist-tags": { canary: "5.4.1-canary.3" },
    versions: {
      "5.4.1-canary.1": { dist: { integrity: "sha512-cli1" } },
      "5.4.1-canary.3": { dist: { integrity: "sha512-cli3" } },
    },
  },
  "@mcp-use/inspector": {
    "dist-tags": { canary: "20.3.34-canary.0" },
    versions: {
      "20.3.34-canary.0": { dist: { integrity: "sha512-inspector" } },
    },
  },
  "@mcp-use/agent": {
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": { dist: { integrity: "sha512-agent" } } },
  },
};
