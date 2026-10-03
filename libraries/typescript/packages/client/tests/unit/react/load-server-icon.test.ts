import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadServerIcon } from "../../../src/react/useMcp-helpers.js";
import { detectFavicon } from "../../../src/utils/favicon.js";

vi.mock("../../../src/utils/favicon.js", () => ({
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

async function loadIcon(iconResponse: Response | Error) {
  vi.stubGlobal(
    "fetch",
    iconResponse instanceof Error
      ? vi.fn().mockRejectedValue(iconResponse)
      : vi.fn().mockResolvedValue(iconResponse)
  );
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
    vi.clearAllMocks();
  });

  it("uses the server-provided icon when it loads", async () => {
    const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });

    const { result, icon } = await loadIcon(new Response(png));

    expect(result).toBe("data:image/png;base64,iVBORw==");
    expect(icon).toBe(result);
    expect(detectFavicon).not.toHaveBeenCalled();
  });

  it("falls back to the favicon when the icon request returns an HTTP error", async () => {
    const { result, icon } = await loadIcon(
      new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/html" },
      })
    );

    expect(result).toBe(FAVICON);
    expect(icon).toBe(FAVICON);
    expect(detectFavicon).toHaveBeenCalledWith("https://mcp.example.com/mcp");
  });

  it("falls back to the favicon when the icon request fails", async () => {
    const { result, icon } = await loadIcon(new TypeError("Failed to fetch"));

    expect(result).toBe(FAVICON);
    expect(icon).toBe(FAVICON);
  });
});
