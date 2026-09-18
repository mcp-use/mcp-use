import { describe, expect, it, vi } from "vitest";
import { MCPServer } from "../src/server.js";
import { mcpUseTanStackStart } from "../src/tanstack-start/vite.js";

describe("TanStack Start plugin configuration", () => {
  it.each(["/", "/api//mcp", "/api mcp", "/api\tmcp", "relative", "/api?mcp", "/api#mcp"])("rejects invalid basePath %j before building", (basePath) => {
    expect(() => mcpUseTanStackStart({ basePath })).toThrow("concrete absolute path");
  });
});

it("decodes embedded assets only on the first GET and keeps response bodies independent", async () => {
  const server = new MCPServer({ name: "asset-cache", version: "1", basePath: "/mcp" });
  server.__primeViews({}, { assets: {
    "public/cache.svg": { body: btoa("<svg>cache</svg>"), contentType: "image/svg+xml" },
  } });
  await server.__mount();
  const decode = vi.spyOn(globalThis, "atob");
  try {
    const url = "http://localhost/mcp/_mcp-use/public/cache.svg";
    await server.fetch(new Request(url, { method: "HEAD" }));
    expect(decode).not.toHaveBeenCalled();
    const first = await server.fetch(new Request(url));
    const second = await server.fetch(new Request(url));
    expect(await first.text()).toBe("<svg>cache</svg>");
    expect(await second.text()).toBe("<svg>cache</svg>");
    expect(decode).toHaveBeenCalledOnce();
  } finally {
    decode.mockRestore();
    await server.close();
  }
});
