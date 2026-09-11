import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCPServer } from "../src/server.js";
import { oauthCustomProvider } from "../src/oauth/provider.js";
import { createTanStackStartHandler } from "../src/tanstack-start/index.js";
import type { TanStackStartBuild } from "../src/tanstack-start/types.js";

const loadBuild = vi.hoisted(() => vi.fn<() => Promise<TanStackStartBuild>>());
vi.mock("#mcp-use-tanstack-start-build", () => ({
  loadTanStackStartBuild: loadBuild,
}));

const build: TanStackStartBuild = {
  basePath: "/api/mcp",
  views: { card: { kind: "external", entry: "assets/card.js", css: [] } },
  assets: {
    "card/assets/card.js": {
      body: btoa("export const card = true;"),
      contentType: "application/javascript",
    },
    "public/logo.svg": { body: btoa("<svg/>"), contentType: "image/svg+xml" },
  },
  skills: { skills: [], resources: [], directories: [] },
};

beforeEach(() => {
  loadBuild.mockReset().mockResolvedValue(build);
});

function makeServer(origin: string | string[] = "*") {
  const server = new MCPServer({
    name: "tanstack-start-test",
    version: "1",
    basePath: "/api/mcp",
    cors: { origin, methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"] },
  });
  server.tool(
    {
      name: "card",
      inputSchema: z.object({}),
      outputSchema: z.object({ title: z.string() }),
      view: { name: "card" },
    },
    async () => ({ content: [], structuredContent: { title: "Ready" } })
  );
  return server;
}

describe("TanStack Start handler", () => {
  it("initializes once across concurrent requests and serves bundled assets", async () => {
    const server = makeServer();
    const primeSkills = vi.spyOn(server, "__primeSkills");
    const handler = createTanStackStartHandler(server);
    expect(loadBuild).not.toHaveBeenCalled();
    const [js, image] = await Promise.all([
      handler(
        new Request(
          "http://localhost/api/mcp/_mcp-use/views/card/assets/card.js"
        )
      ),
      handler(new Request("http://localhost/api/mcp/_mcp-use/public/logo.svg")),
    ]);
    expect(loadBuild).toHaveBeenCalledOnce();
    expect(primeSkills).toHaveBeenCalledWith(build.skills);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("application/javascript");
    expect(await js.text()).toBe("export const card = true;");
    expect(await image.text()).toBe("<svg/>");
  });

  it("preserves configured CORS for assets and OPTIONS", async () => {
    const handler = createTanStackStartHandler(
      makeServer(["https://allowed.test"])
    );
    for (const origin of ["https://allowed.test", "https://denied.test"]) {
      const response = await handler(
        new Request("http://localhost/api/mcp/_mcp-use/public/logo.svg", {
          headers: { origin },
        })
      );
      expect(response.headers.get("access-control-allow-origin")).toBe(
        origin === "https://allowed.test" ? origin : null
      );
    }
    const response = await handler(
      new Request("http://localhost/api/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://allowed.test" },
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "DELETE"
    );
  });

  it("handles HEAD and rejects missing, malformed and traversal asset paths", async () => {
    const handler = createTanStackStartHandler(makeServer());
    const head = await handler(
      new Request("http://localhost/api/mcp/_mcp-use/public/logo.svg", {
        method: "HEAD",
      })
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const path of ["missing.svg", "%", "..%2flogo.svg", "constructor"]) {
      const response = await handler(
        new Request(`http://localhost/api/mcp/_mcp-use/public/${path}`)
      );
      expect(response.status).toBe(404);
    }
  });

  it("forwards request bodies and cancellation without buffering response streams", async () => {
    const server = makeServer();
    const canceled = vi.fn();
    let receivedSignal: AbortSignal | undefined;
    server.post("/api/mcp/stream", async (context) => {
      receivedSignal = context.req.raw.signal;
      const body = await context.req.text();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
          },
          cancel: canceled,
        })
      );
    });
    const handler = createTanStackStartHandler(server);
    const controller = new AbortController();
    const response = await handler(
      new Request("http://localhost/api/mcp/stream", {
        method: "POST",
        body: "first chunk",
        signal: controller.signal,
      })
    );
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "first chunk"
    );
    controller.abort();
    expect(receivedSignal?.aborted).toBe(true);
    await reader.cancel();
    expect(canceled).toHaveBeenCalledOnce();
  });

  it("rejects mismatched route configuration before mounting", async () => {
    const server = new MCPServer({
      name: "wrong-path",
      version: "1",
      basePath: "/other",
    });
    const handler = createTanStackStartHandler(server);
    await expect(
      handler(new Request("http://localhost/api/mcp"))
    ).rejects.toThrow("basePath mismatch");
  });

  it("keeps OAuth discovery public outside the authenticated MCP route", async () => {
    loadBuild.mockResolvedValue({ ...build, views: {}, assets: {} });
    const server = new MCPServer({
      name: "oauth-start",
      version: "1",
      basePath: "/api/mcp",
      oauth: oauthCustomProvider({
        resource: "https://app.test/api/mcp",
        oauthMetadata: {
          issuer: "https://issuer.test",
          authorization_endpoint: "https://issuer.test/authorize",
          token_endpoint: "https://issuer.test/token",
          response_types_supported: ["code"],
        },
        createTokenVerifier: (resource) => ({
          verifyAccessToken: async (token) => ({
            token,
            clientId: "test",
            scopes: [],
            resource,
          }),
        }),
        mapAuthInfo: () => ({
          user: { id: "test" },
          payload: {},
          permissions: [],
        }),
      }),
    });
    const handler = createTanStackStartHandler(server);
    const discovery = await handler(
      new Request(
        "https://app.test/.well-known/oauth-protected-resource/api/mcp"
      )
    );
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      resource: "https://app.test/api/mcp",
    });
    const rejected = await handler(
      new Request("https://app.test/api/mcp", { method: "POST" })
    );
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/api/mcp"
    );
  });

  it("surfaces missing plugin/build errors", async () => {
    loadBuild.mockRejectedValue(new Error("Add mcpUseTanStackStart()"));
    const handler = createTanStackStartHandler(makeServer());
    await expect(
      handler(new Request("http://localhost/api/mcp"))
    ).rejects.toThrow("mcpUseTanStackStart");
  });
});
