import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectFavicon } from "../../../src/utils/favicon.js";

describe("detectFavicon", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips localhost without fetching", async () => {
    expect(await detectFavicon("http://localhost:3000/mcp")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips 127.0.0.1 without fetching", async () => {
    expect(await detectFavicon("http://127.0.0.1:8080/mcp")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses hostname without scheme and still skips localhost", async () => {
    expect(await detectFavicon("localhost:3000/mcp")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat 10.example.com as local", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    await detectFavicon("https://10.example.com/mcp");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("10.example.com"),
      expect.any(Object)
    );
  });

  it("extracts mcp.linear.app from a full URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    await detectFavicon("http://mcp.linear.app/mcp");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("mcp.linear.app"),
      expect.any(Object)
    );
  });

  it("skips default favicons and returns null when all levels are default", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        url: "https://cdn.example.com/favicon.ico",
        source: "default",
      }),
    }));

    expect(await detectFavicon("https://mcp.example.com/mcp")).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns a data URL for a non-default favicon", async () => {
    class MockFileReader {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(_blob: Blob) {
        this.result = "data:image/png;base64,abc";
        this.onloadend?.();
      }
    }
    vi.stubGlobal("FileReader", MockFileReader);

    fetchMock.mockImplementation(async (url: string) => {
      if (new URL(url).hostname === "favicon.tools.mcp-use.com") {
        return {
          ok: true,
          json: async () => ({
            url: "http://cdn.example.com/icon.png",
            source: "link-tag",
          }),
        };
      }
      return {
        ok: true,
        blob: async () => new Blob(["x"], { type: "image/png" }),
      };
    });

    expect(await detectFavicon("https://mcp.example.com/mcp")).toBe(
      "data:image/png;base64,abc"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/icon.png",
      expect.any(Object)
    );
  });
});
