import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MCPServer } from "../src/server.js";
import { composeNextConfig } from "../src/next/config.js";
import { createNextHandler } from "../src/next/handler.js";
import type { ViewsManifest } from "../src/views/types.js";

const temporaryDirectories: string[] = [];

async function makeProject(views?: unknown): Promise<string> {
  const root = join(
    tmpdir(),
    `mcp-use-next-${process.pid}-${Date.now()}-${temporaryDirectories.length}`
  );
  temporaryDirectories.push(root);
  if (views !== undefined) {
    const build = join(root, ".mcp-use", "build");
    await mkdir(build, { recursive: true });
    await writeFile(
      join(build, "manifest.json"),
      `${JSON.stringify({
        buildId: "test",
        entryPoint: "index.js",
        createdAt: new Date(0).toISOString(),
        views,
      })}\n`
    );
  }
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("createNextHandler", () => {
  it("lazily primes the authored server and reuses one web handler", async () => {
    const manifest: ViewsManifest = {
      card: { kind: "inline", js: "export {};", css: "" },
    };
    const projectRoot = await makeProject(manifest);
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
    const prime = vi.fn();
    const fetch = vi.fn(async () => new Response("ok"));
    const server = {
      __primeViews: prime,
      fetch,
    } as unknown as MCPServer;

    const handlers = createNextHandler(server);
    const preflight = await handlers.OPTIONS(
      new Request("http://localhost/api/mcp", { method: "OPTIONS" })
    );
    const first = await handlers.POST(
      new Request("http://localhost/api/mcp", { method: "POST" })
    );
    const second = await handlers.GET(
      new Request("http://localhost/api/mcp", { method: "GET" })
    );

    expect(await first.text()).toBe("ok");
    expect(await second.text()).toBe("ok");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(prime).toHaveBeenCalledOnce();
    expect(prime).toHaveBeenCalledWith(manifest, { projectRoot });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("explains how to create a missing embedded build", async () => {
    const projectRoot = await makeProject();
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
    const server = {
      __primeViews: vi.fn(),
      fetch: vi.fn(),
    } as unknown as MCPServer;
    const { GET } = createNextHandler(server);

    await expect(GET(new Request("http://localhost/api/mcp"))).rejects.toThrow(
      /Wrap next\.config with withMcpUse\(\)/
    );
  });

  it("rejects malformed generated view data before starting the server", async () => {
    const projectRoot = await makeProject({ card: { kind: "external" } });
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
    const fetch = vi.fn();
    const server = {
      __primeViews: vi.fn(),
      fetch,
    } as unknown as MCPServer;
    const { GET } = createNextHandler(server);

    await expect(GET(new Request("http://localhost/api/mcp"))).rejects.toThrow(
      /Invalid mcp-use build manifest/
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("withMcpUse config composition", () => {
  it("preserves user headers and tracing while owning MCP CORS headers", async () => {
    const config = composeNextConfig(
      {
        async headers() {
          return [
            {
              source: "/api/mcp/:path*",
              headers: [
                { key: "X-App", value: "kept" },
                { key: "Access-Control-Allow-Origin", value: "old" },
              ],
            },
            {
              source: "/other",
              headers: [{ key: "X-Other", value: "kept" }],
            },
          ];
        },
        outputFileTracingIncludes: {
          "/api/mcp": ["./already/**/*"],
          "/other": ["./other/**/*"],
        },
      },
      "/api/mcp"
    );

    const rules = await config.headers?.();
    expect(rules).toHaveLength(2);
    expect(rules?.[0]?.headers).toContainEqual({ key: "X-App", value: "kept" });
    expect(rules?.[0]?.headers).toContainEqual({
      key: "Access-Control-Allow-Origin",
      value: "*",
    });
    expect(
      rules?.[0]?.headers.filter(
        ({ key }) => key.toLowerCase() === "access-control-allow-origin"
      )
    ).toHaveLength(1);
    expect(config.outputFileTracingIncludes).toEqual({
      "/api/mcp": ["./already/**/*", "./.mcp-use/build/**/*"],
      "/other": ["./other/**/*"],
    });
  });

  it("adds an MCP rule without replacing unrelated config", async () => {
    const config = composeNextConfig({ reactStrictMode: true }, "/custom/mcp");

    expect(config.reactStrictMode).toBe(true);
    expect(await config.headers?.()).toEqual([
      expect.objectContaining({ source: "/custom/mcp/:path*" }),
    ]);
    expect(config.outputFileTracingIncludes?.["/custom/mcp"]).toEqual([
      "./.mcp-use/build/**/*",
    ]);
  });
});
