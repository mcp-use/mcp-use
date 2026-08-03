import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MCPServer, registerViews } from "../src/index.js";
import { oauthCustomProvider, type OAuthMetadata } from "../src/oauth/index.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mcp-use-branding-"));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = join(root, "public", relativePath);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, contents);
  }
  return root;
}

function primeDev<TUser>(server: MCPServer<TUser>, projectRoot: string): void {
  server[registerViews]({}, { dev: true, projectRoot });
}

function makeClient(): Client {
  return new Client(
    { name: "branding-test-client", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
}

describe("server branding", () => {
  it("reports canonical websiteUrl/icons and uses the first icon for the favicon", async () => {
    const root = project({
      "brand/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      "brand/icon-32.png": "png-32",
      "brand/favicon.ico": "ico",
    });
    const server = new MCPServer({
      name: "branding-test",
      version: "1.0.0",
      websiteUrl: "https://example.com/server",
      cors: { origin: "https://app.example.test" },
      icons: [
        { src: "brand/icon.svg", mimeType: "image/svg+xml" },
        {
          src: "brand/icon-32.png",
          mimeType: "image/png",
          sizes: ["32x32"],
        },
        { src: "brand/favicon.ico", mimeType: "image/x-icon" },
      ],
    });
    primeDev(server, root);

    expect(server.branding.favicon).toBe("brand/icon.svg");
    const started = await server.listen(0);
    const client = makeClient();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url))
    );

    const identity = client.getServerVersion();
    expect(identity?.websiteUrl).toBe("https://example.com/server");
    expect(identity?.icons).toEqual([
      {
        src: `${new URL(started.url).origin}/mcp/_mcp-use/public/brand/icon.svg`,
        mimeType: "image/svg+xml",
      },
      {
        src: `${new URL(started.url).origin}/mcp/_mcp-use/public/brand/icon-32.png`,
        mimeType: "image/png",
        sizes: ["32x32"],
      },
      {
        src: `${new URL(started.url).origin}/mcp/_mcp-use/public/brand/favicon.ico`,
        mimeType: "image/x-icon",
      },
    ]);

    const favicon = await fetch(`${new URL(started.url).origin}/favicon.ico`);
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toBe("image/svg+xml");
    expect(favicon.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(favicon.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.test"
    );
    expect(await favicon.text()).toContain("<svg");

    const head = await fetch(`${new URL(started.url).origin}/favicon.ico`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/svg+xml");
    expect(await head.text()).toBe("");

    const publicIcon = await fetch(identity!.icons![0]!.src);
    expect(publicIcon.status).toBe(200);
    expect(publicIcon.headers.get("content-type")).toBe("image/svg+xml");
    expect(publicIcon.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.test"
    );

    const landing = await fetch(started.url, {
      headers: { Accept: "text/html" },
    });
    const landingHtml = await landing.text();
    const faviconUrl = `${new URL(started.url).origin}/favicon.ico`;
    expect(landingHtml).toContain(
      `<link rel="icon" type="image/svg+xml" href="${faviconUrl}">`
    );
    expect(landingHtml).toContain(`<img src="${faviconUrl}"`);

    const inspector = await fetch(
      `${new URL(started.url).origin}/mcp/inspector`
    );
    expect(inspector.status).toBe(404);

    await client.close();
    await server.close();
  });

  it("lets an explicit local favicon override icon selection", async () => {
    const root = project({
      "explicit.svg": "<svg></svg>",
      "preferred.ico": "ico",
    });
    const server = new MCPServer({
      name: "override-test",
      version: "1.0.0",
      favicon: "explicit.svg",
      icons: [
        { src: "preferred.ico", mimeType: "image/x-icon" },
        { src: "explicit.svg", mimeType: "image/svg+xml" },
      ],
    });
    primeDev(server, root);
    const handler = server.fetch;

    expect(server.branding.favicon).toBe("explicit.svg");
    const response = await handler(new Request("http://localhost/favicon.ico"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toBe("<svg></svg>");

    const unsupported = await handler(
      new Request("http://localhost/favicon.ico", { method: "POST" })
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, HEAD");

    await server.close();
  });

  it("uses the first icon for favicon when favicon is omitted", () => {
    const server = new MCPServer({
      name: "png-rank-test",
      version: "1.0.0",
      icons: [
        { src: "icon.svg", mimeType: "image/svg+xml" },
        { src: "large.png", mimeType: "image/png", sizes: ["512x512"] },
        { src: "small.png", mimeType: "image/png", sizes: ["32x32"] },
      ],
    });
    expect(server.branding.favicon).toBe("icon.svg");

    const queriedIco = new MCPServer({
      name: "queried-ico-rank-test",
      version: "1.0.0",
      icons: [
        { src: "small.png", mimeType: "image/png", sizes: ["32x32"] },
        { src: "https://cdn.example.com/favicon.ico?v=2" },
      ],
    });
    expect(queriedIco.branding.favicon).toBe("small.png");

    const dataIco = "data:image/x-icon;base64,aWNv";
    const inferredDataMime = new MCPServer({
      name: "data-mime-rank-test",
      version: "1.0.0",
      icons: [
        { src: "small.png", mimeType: "image/png", sizes: ["32x32"] },
        { src: dataIco },
      ],
    });
    expect(inferredDataMime.branding.favicon).toBe("small.png");
  });

  it("serves data favicons and redirects absolute favicons without fetching", async () => {
    const dataServer = new MCPServer({
      name: "data-favicon",
      version: "1.0.0",
      icons: [
        {
          src: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
          mimeType: "image/svg+xml",
        },
      ],
    });
    const dataResponse = await dataServer.fetch(
      new Request("http://localhost/favicon.ico")
    );
    expect(dataResponse.status).toBe(200);
    expect(dataResponse.headers.get("content-type")).toBe("image/svg+xml");
    expect(await dataResponse.text()).toContain("<svg");
    await dataServer.close();

    const remoteServer = new MCPServer({
      name: "remote-favicon",
      version: "1.0.0",
      favicon: "https://cdn.example.com/favicon.png?v=2",
    });
    const handler = remoteServer.fetch;
    for (const method of ["GET", "HEAD"]) {
      const response = await handler(
        new Request("http://localhost/favicon.ico", { method })
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://cdn.example.com/favicon.png?v=2"
      );
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    }
    await remoteServer.close();
  });

  it("treats empty icons as no favicon and returns 404 for missing files", async () => {
    const empty = new MCPServer({
      name: "empty-icons",
      version: "1.0.0",
      icons: [],
    });
    expect(empty.branding.icons).toEqual([]);
    expect(empty.branding.favicon).toBeUndefined();
    expect(
      (await empty.fetch(new Request("http://localhost/favicon.ico"))).status
    ).toBe(404);
    await empty.close();

    const missing = new MCPServer({
      name: "missing-icon",
      version: "1.0.0",
      favicon: "missing.svg",
    });
    const missingResponse = await missing.fetch(
      new Request("http://localhost/favicon.ico")
    );
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get("cache-control")).toBe("no-store");
    await missing.close();
  });

  it("serves safe local filenames containing consecutive dots", async () => {
    const root = project({ "brand/icon..png": "png" });
    const server = new MCPServer({
      name: "consecutive-dots",
      version: "1.0.0",
      favicon: "brand/icon..png",
    });
    primeDev(server, root);

    const response = await server.fetch(
      new Request("http://localhost/favicon.ico")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("png");
    await server.close();
  });

  it("rejects invalid branding values at construction", () => {
    const cases: Array<Record<string, unknown>> = [
      { favicon: "" },
      { favicon: "../secret.png" },
      { favicon: "/root.png" },
      { favicon: "ftp://example.com/icon.png" },
      { favicon: "data:text/html,not-an-image" },
      { websiteUrl: "/relative" },
      { websiteUrl: "file:///tmp/site" },
      { icons: "icon.png" },
      { icons: [{}] },
      { icons: [{ src: "icon.png", mimeType: "text/plain" }] },
      { icons: [{ src: "icon.png", sizes: [16] }] },
      { icons: [{ src: "icon.png", theme: "auto" }] },
    ];
    for (const config of cases) {
      expect(
        () =>
          new MCPServer({
            name: "invalid-branding",
            version: "1.0.0",
            ...config,
          } as never)
      ).toThrow(TypeError);
    }
  });

  it("keeps favicon root-level while local icon URLs follow custom and root basePath", async () => {
    for (const basePath of ["/api/mcp", "/"] as const) {
      const root = project({ "icon.png": "png" });
      const server = new MCPServer({
        name: `base-path-${basePath}`,
        version: "1.0.0",
        basePath,
        icons: [{ src: "icon.png", mimeType: "image/png" }],
      });
      primeDev(server, root);
      const started = await server.listen(0);
      const client = makeClient();
      await client.connect(
        new StreamableHTTPClientTransport(new URL(started.url))
      );
      const expectedPublicPath =
        basePath === "/"
          ? "/_mcp-use/public/icon.png"
          : `${basePath}/_mcp-use/public/icon.png`;
      expect(client.getServerVersion()?.icons?.[0]?.src).toBe(
        `${new URL(started.url).origin}${expectedPublicPath}`
      );
      expect(
        (await fetch(`${new URL(started.url).origin}/favicon.ico`)).status
      ).toBe(200);
      expect(
        (await fetch(`${new URL(started.url).origin}${expectedPublicPath}`))
          .status
      ).toBe(200);
      await client.close();
      await server.close();
    }
  });

  it("coexists with OAuth metadata while the exact MCP route stays gated", async () => {
    const root = project({ "oauth-icon.svg": "<svg></svg>" });
    const oauth = oauthCustomProvider({
      resource: "https://canonical.example.test/api/mcp",
      createTokenVerifier: (resource) => ({
        verifyAccessToken: async (token) => ({
          token,
          clientId: "test-client",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource,
        }),
      }),
      oauthMetadata: {
        issuer: "https://issuer.example.test",
      } as OAuthMetadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: { sub: "user-1" },
        permissions: [],
      }),
    });
    const server = new MCPServer({
      name: "oauth-branding",
      version: "1.0.0",
      basePath: "/api/mcp",
      publicLandingPage: true,
      icons: [{ src: "oauth-icon.svg", mimeType: "image/svg+xml" }],
      oauth,
    });
    primeDev(server, root);
    const handler = server.fetch;

    expect(
      (await handler(new Request("https://request.example/favicon.ico"))).status
    ).toBe(200);
    expect(
      (
        await handler(
          new Request(
            "https://request.example/api/mcp/_mcp-use/public/oauth-icon.svg"
          )
        )
      ).status
    ).toBe(200);
    expect(
      (
        await handler(
          new Request(
            "https://request.example/.well-known/oauth-protected-resource/api/mcp"
          )
        )
      ).status
    ).toBe(200);
    expect(
      (
        await handler(
          new Request("https://request.example/api/mcp", { method: "POST" })
        )
      ).status
    ).toBe(401);
    expect(
      (await handler(new Request("https://request.example/api/mcp/inspector")))
        .status
    ).toBe(404);
    const landing = await handler(
      new Request("https://request.example/api/mcp", {
        headers: { Accept: "text/html" },
      })
    );
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain(
      '<link rel="icon" type="image/svg+xml" href="https://request.example/favicon.ico">'
    );

    await server.close();
  });
});
