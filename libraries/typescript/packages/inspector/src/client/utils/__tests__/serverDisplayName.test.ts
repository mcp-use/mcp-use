import { describe, expect, it } from "vitest";
import { getConfiguredServerAlias, getServerDisplayName } from "../servers";

describe("server display names", () => {
  const server = {
    url: "https://example.com/mcp",
    name: "ConformanceTestServer",
    serverInfo: { name: "ConformanceTestServer", title: "Conformance Server" },
  };

  it("prefers the saved alias over MCP metadata", () => {
    const renamed = { ...server, displayName: " QA Conformance " };
    expect(getConfiguredServerAlias(renamed)).toBe("QA Conformance");
    expect(getServerDisplayName(renamed)).toBe("QA Conformance");
    expect(renamed.name).toBe("ConformanceTestServer");
  });

  it.each([undefined, "", "   ", server.url])(
    "falls back to the server title when the alias is %j",
    (displayName) => {
      const cleared = { ...server, displayName };
      expect(getConfiguredServerAlias(cleared)).toBe("");
      expect(getServerDisplayName(cleared)).toBe("Conformance Server");
    }
  );

  it("falls back to the MCP name, URL, and unknown label", () => {
    expect(getServerDisplayName({ ...server, serverInfo: undefined })).toBe(
      "ConformanceTestServer"
    );
    expect(getServerDisplayName({ url: server.url })).toBe(server.url);
    expect(getServerDisplayName({})).toBe("Unknown server");
  });
});
