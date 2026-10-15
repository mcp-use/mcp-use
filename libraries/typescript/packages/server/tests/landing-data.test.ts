import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  __setLandingData,
  __withLandingData,
  type LandingData,
  usePromptList,
  useResourceList,
  useServerInfo,
  useToolList,
} from "../src/landing.js";

const server = {
  name: "weather",
  version: "1.0.0",
  url: "https://server.example.test/mcp",
  publicBaseUrl: "https://server.example.test/mcp/_mcp-use/public/",
};

const fullData: LandingData = {
  server,
  tools: [{ name: "forecast", title: "Forecast", description: "Get weather" }],
  prompts: [{ name: "plan" }],
  resources: [{ uri: "docs://weather", name: "docs" }],
};

describe("landing hooks", () => {
  it("throw a named error outside a landing render", () => {
    expect(() => useServerInfo()).toThrow(
      "useServerInfo() was called outside the landing page."
    );
    expect(() => useToolList()).toThrow(
      "useToolList() was called outside the landing page."
    );
  });

  it("read the data of the active render", () => {
    const read = __withLandingData(fullData, () => ({
      server: useServerInfo(),
      tools: useToolList(),
      prompts: usePromptList(),
      resources: useResourceList(),
    }));
    expect(read).toEqual(fullData);
    expect(read.server).toBe(server);
  });

  it("throw a named error for a list missing from the data", () => {
    __withLandingData({ server, tools: [] }, () => {
      expect(useToolList()).toEqual([]);
      expect(() => usePromptList()).toThrow(
        "usePromptList() has no data. Import it in a module under landing.tsx."
      );
      expect(() => useResourceList()).toThrow("useResourceList() has no data.");
    });
  });

  it("restore the previous data after nested and throwing renders", () => {
    const outer: LandingData = { server: { ...server, name: "outer" } };
    const inner: LandingData = { server: { ...server, name: "inner" } };
    __withLandingData(outer, () => {
      expect(__withLandingData(inner, () => useServerInfo().name)).toBe(
        "inner"
      );
      expect(useServerInfo().name).toBe("outer");
      expect(() =>
        __withLandingData(inner, () => {
          throw new Error("render failed");
        })
      ).toThrow("render failed");
      expect(useServerInfo().name).toBe("outer");
    });
    expect(() => useServerInfo()).toThrow("outside the landing page");
  });

  it("keep browser data set for hydration until cleared", () => {
    __setLandingData(fullData);
    try {
      expect(useServerInfo()).toBe(server);
      expect(useToolList()).toBe(fullData.tools);
    } finally {
      __setLandingData(undefined);
    }
    expect(() => useServerInfo()).toThrow("outside the landing page");
  });

  it("keep mcp-use/landing and the landing handler free of React", () => {
    for (const file of [
      "../src/landing.ts",
      "../src/landing-data.ts",
      "../src/landing-handler.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["']react/);
    }
  });
});
