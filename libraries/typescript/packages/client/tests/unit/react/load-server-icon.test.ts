import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadServerIcon } from "../../../src/react/useMcp-helpers.js";
import { detectFavicon } from "../../../src/utils/favicon.js";
import type * as favicon from "../../../src/utils/favicon.js";

vi.mock("../../../src/utils/favicon.js", async (importOriginal) => ({
  ...(await importOriginal<typeof favicon>()),
  detectFavicon: vi.fn(),
}));

// Node has no FileReader; build the data URL from the blob like a browser.
class BlobFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    }, this.onerror);
  }
}

const FAVICON = "data:image/png;base64,ZmF2aWNvbg==";

async function loadIcon(fetchIcon: typeof fetch) {
  vi.stubGlobal("fetch", fetchIcon);
  let serverInfo: { name: string; version: string; icon?: string } = {
    name: "demo",
    version: "1.0.0",
  };
  const result = await loadServerIcon({
    serverInfo: {
      ...serverInfo,
      icons: [{ src: "https://mcp.example.com/icon.png" }],
    },
    url: "https://mcp.example.com/mcp",
    isMounted: () => true,
    setServerInfo: (update) => {
      serverInfo = update(serverInfo) ?? serverInfo;
    },
    addLog: vi.fn(),
  });
  return { result, icon: serverInfo.icon };
}

describe("loadServerIcon", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", BlobFileReader);
    vi.mocked(detectFavicon).mockResolvedValue(FAVICON);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uses the server-provided icon when it loads", async () => {
    const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });

    const { result, icon } = await loadIcon(
      vi.fn().mockResolvedValue(new Response(png))
    );

    expect(result).toBe("data:image/png;base64,iVBORw==");
    expect(icon).toBe(result);
    expect(detectFavicon).not.toHaveBeenCalled();
  });

  it("falls back to the favicon when the icon request returns an HTTP error", async () => {
    const { result, icon } = await loadIcon(
      vi.fn().mockResolvedValue(
        new Response("Not Found", {
          status: 404,
          headers: { "content-type": "text/html" },
        })
      )
    );

    expect(result).toBe(FAVICON);
    expect(icon).toBe(FAVICON);
    expect(detectFavicon).toHaveBeenCalledWith("https://mcp.example.com/mcp");
  });

  it("falls back to the favicon when the icon request fails", async () => {
    const { result, icon } = await loadIcon(
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    expect(result).toBe(FAVICON);
    expect(icon).toBe(FAVICON);
  });

  it("falls back to the favicon when the icon host never answers", async () => {
    // Keep the real abort behavior without waiting seconds for it.
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(10));
    const neverAnswers = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );

    const { result, icon } = await loadIcon(neverAnswers);

    expect(result).toBe(FAVICON);
    expect(icon).toBe(FAVICON);
  }, 2_000);
});
