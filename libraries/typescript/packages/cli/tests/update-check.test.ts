import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyIfUpdateAvailable } from "../src/utils/update-check.js";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const fetchVersion = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchVersion);
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({ version: "1.34.6" })
  );
  vi.mocked(readFile).mockRejectedValue(new Error("no cache"));
  fetchVersion.mockResolvedValue(
    new Response(JSON.stringify({ version: "1.34.7" }))
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  if (originalTTY) {
    Object.defineProperty(process.stdout, "isTTY", originalTTY);
  } else {
    Reflect.deleteProperty(process.stdout, "isTTY");
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("maintenance update notifications", () => {
  it("queries legacy-v1 and recommends that channel for a v1 installation", async () => {
    await notifyIfUpdateAvailable(undefined);
    expect(fetchVersion).toHaveBeenCalledWith(
      "https://registry.npmjs.org/mcp-use/legacy-v1",
      expect.any(Object)
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("npm install mcp-use@legacy-v1")
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"distTag": "legacy-v1"'),
      "utf-8"
    );
  });

  it("keeps the latest channel for a v2 installation", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ version: "2.8.0" })
    );
    fetchVersion.mockResolvedValue(
      new Response(JSON.stringify({ version: "2.8.1" }))
    );
    await notifyIfUpdateAvailable(undefined);
    expect(fetchVersion).toHaveBeenCalledWith(
      "https://registry.npmjs.org/mcp-use/latest",
      expect.any(Object)
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("npm install mcp-use@latest")
    );
  });

  it("does not fetch or print update notices in piped output", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    await notifyIfUpdateAvailable(undefined);
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each(["latest", undefined])(
    "ignores an old cache from channel %s",
    async (distTag) => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          lastChecked: new Date().toISOString(),
          latestVersion: "2.8.1",
          distTag,
        })
      );
      fetchVersion.mockResolvedValue(
        new Response(JSON.stringify({ version: "1.34.6" }))
      );
      await notifyIfUpdateAvailable(undefined);
      expect(fetchVersion).toHaveBeenCalledWith(
        "https://registry.npmjs.org/mcp-use/legacy-v1",
        expect.any(Object)
      );
      expect(console.log).not.toHaveBeenCalled();
    }
  );

  it("uses a fresh cache for the selected maintenance channel", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        lastChecked: new Date().toISOString(),
        latestVersion: "1.34.7",
        distTag: "legacy-v1",
      })
    );
    await notifyIfUpdateAvailable(undefined);
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("npm install mcp-use@legacy-v1")
    );
  });

  it("refreshes an expired maintenance cache", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        lastChecked: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        latestVersion: "1.34.6",
        distTag: "legacy-v1",
      })
    );
    await notifyIfUpdateAvailable(undefined);
    expect(fetchVersion).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1.34.7"));
  });

  it("stays silent on registry failures", async () => {
    fetchVersion.mockRejectedValue(new Error("registry unavailable"));
    await notifyIfUpdateAvailable(undefined);
    expect(console.log).not.toHaveBeenCalled();
  });
});
