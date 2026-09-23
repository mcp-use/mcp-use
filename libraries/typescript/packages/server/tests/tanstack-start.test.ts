import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTanStackStartHandler } from "../src/tanstack-start/index.js";

const handle = vi.hoisted(() =>
  vi.fn<(request: Request) => Promise<Response>>()
);
vi.mock("#mcp-use-vite-handler", () => ({ handleMcpRequest: handle }));
beforeEach(() => handle.mockReset());

describe("TanStack Start route adapter", () => {
  it("forwards the original request and streaming response without buffering", async () => {
    const canceled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("first chunk"));
        },
        cancel: canceled,
      })
    );
    handle.mockResolvedValue(response);
    const controller = new AbortController();
    const request = new Request("https://app.test/api/mcp", {
      method: "POST",
      body: "payload",
      signal: controller.signal,
    });
    expect(await createTanStackStartHandler()(request)).toBe(response);
    expect(handle).toHaveBeenCalledWith(request);
    expect(await request.text()).toBe("payload");
    controller.abort();
    expect(request.signal.aborted).toBe(true);
    await response.body!.cancel();
    expect(canceled).toHaveBeenCalledOnce();
  });

  it("looks up the active handler on every request, including discovery and assets", async () => {
    const handler = createTanStackStartHandler();
    for (const path of [
      "/api/mcp",
      "/api/mcp/_mcp-use/public/logo.svg",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]) {
      handle.mockResolvedValueOnce(new Response(path));
      expect(
        await (await handler(new Request(`https://app.test${path}`))).text()
      ).toBe(path);
    }
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it("surfaces plugin errors without permanently caching a failed initialization", async () => {
    const handler = createTanStackStartHandler();
    handle.mockRejectedValueOnce(new Error("Add mcpUseTanStackStart()"));
    await expect(
      handler(new Request("http://localhost/api/mcp"))
    ).rejects.toThrow("mcpUseTanStackStart");
    handle.mockResolvedValueOnce(new Response("recovered"));
    expect(
      await (await handler(new Request("http://localhost/api/mcp"))).text()
    ).toBe("recovered");
  });
});
