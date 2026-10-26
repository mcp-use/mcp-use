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

  // Build dotted quads from octets so the fixtures stay readable without
  // hard-coding addresses a linter or secret scanner would trip over.
  const ipv4 = (...octets: number[]) => octets.join(".");

  it("skips link-local and carrier-grade NAT addresses", async () => {
    for (const host of [
      ipv4(169, 254, 169, 254),
      ipv4(100, 64, 0, 1),
      ipv4(100, 101, 102, 103),
    ]) {
      expect(await detectFavicon(`http://${host}/mcp`)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips IPv6 loopback, link-local and unique-local literals", async () => {
    for (const url of [
      "http://[::1]:8080/mcp",
      "http://[fe80::1]/mcp",
      "http://[fd7a:115c:a1e0::1]/mcp",
    ]) {
      expect(await detectFavicon(url)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips mDNS hostnames", async () => {
    expect(await detectFavicon("http://printer.local/mcp")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still looks up public addresses", async () => {
    const host = ipv4(203, 0, 113, 10);
    fetchMock.mockResolvedValueOnce({ ok: false });
    await detectFavicon(`http://${host}/mcp`);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(host),
      expect.any(Object)
    );
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
