import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    accessSync: vi.fn(),
  };
});

import { accessSync } from "node:fs";
import { findChrome, resolveChromePath } from "../src/utils/chrome-path.js";

const mockAccessOnly = (paths: string[]) => {
  vi.mocked(accessSync).mockImplementation(((p: string) => {
    if (paths.includes(p)) return undefined;
    throw new Error(`ENOENT: ${p}`);
  }) as typeof accessSync);
};

describe("findChrome", () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MCP_USE_CHROME_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.CHROME_PATH;
    vi.mocked(accessSync).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("prefers MCP_USE_CHROME_PATH over other env vars", () => {
    process.env.MCP_USE_CHROME_PATH = "/custom/chrome";
    process.env.PUPPETEER_EXECUTABLE_PATH = "/pw/chrome";
    process.env.CHROME_PATH = "/c/chrome";
    mockAccessOnly(["/custom/chrome", "/pw/chrome", "/c/chrome"]);
    expect(findChrome()).toBe("/custom/chrome");
  });

  it("falls back to PUPPETEER_EXECUTABLE_PATH when MCP_USE_CHROME_PATH is unset", () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = "/pw/chrome";
    process.env.CHROME_PATH = "/c/chrome";
    mockAccessOnly(["/pw/chrome", "/c/chrome"]);
    expect(findChrome()).toBe("/pw/chrome");
  });

  it("falls back to CHROME_PATH last", () => {
    process.env.CHROME_PATH = "/c/chrome";
    mockAccessOnly(["/c/chrome"]);
    expect(findChrome()).toBe("/c/chrome");
  });

  it("skips an env-var path that does not exist and falls through to platform table", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    process.env.MCP_USE_CHROME_PATH = "/nope";
    mockAccessOnly([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    expect(findChrome()).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  });

  it("finds the canonical macOS Chrome install", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    mockAccessOnly([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    expect(findChrome()).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  });

  it("falls back to Edge on macOS when Chrome and friends are absent", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    mockAccessOnly([
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]);
    expect(findChrome()).toBe(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  });

  it("walks PATH on linux to find google-chrome", () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    process.env.PATH = "/usr/local/bin:/usr/bin";
    mockAccessOnly(["/usr/bin/google-chrome"]);
    expect(findChrome()).toBe("/usr/bin/google-chrome");
  });

  it("returns null when nothing matches", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    mockAccessOnly([]);
    expect(findChrome()).toBeNull();
  });
});

describe("resolveChromePath", () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MCP_USE_CHROME_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.CHROME_PATH;
    vi.mocked(accessSync).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns the path when one is found", () => {
    process.env.MCP_USE_CHROME_PATH = "/custom/chrome";
    mockAccessOnly(["/custom/chrome"]);
    expect(resolveChromePath()).toBe("/custom/chrome");
  });

  it("throws a user-facing error mentioning the env-var override", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    mockAccessOnly([]);
    expect(() => resolveChromePath()).toThrow(/MCP_USE_CHROME_PATH/);
  });
});
