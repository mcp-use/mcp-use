import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MCPServer } from "../src/index.js";
import { generateLandingPage } from "../src/landing.js";
import { oauthCustomProvider, type OAuthMetadata } from "../src/oauth/index.js";

const servers: MCPServer<unknown>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function track<TUser>(server: MCPServer<TUser>): MCPServer<TUser> {
  servers.push(server as MCPServer<unknown>);
  return server;
}

function htmlRequest(
  url: string,
  options: { method?: "GET" | "HEAD"; token?: string } = {}
): Request {
  return new Request(url, {
    method: options.method ?? "GET",
    headers: {
      accept: "text/html,application/xhtml+xml",
      ...(options.token !== undefined && {
        authorization: `Bearer ${options.token}`,
      }),
    },
  });
}

function oauthProvider(resource: string) {
  return oauthCustomProvider({
    resource,
    createTokenVerifier: (resolvedResource) => ({
      verifyAccessToken: async (token) => ({
        token,
        clientId: "landing-client",
        scopes: ["tools:read"],
        expiresAt: Date.now() / 1000 + 60,
        resource: resolvedResource,
      }),
    }),
    oauthMetadata: {
      issuer: "https://issuer.example.test",
    } as OAuthMetadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: { sub: "user-1" },
      permissions: ["tools:read"],
    }),
  });
}

describe("generateLandingPage", () => {
  it("renders connection details and escapes HTML and JSON-LD inputs", () => {
    const html = generateLandingPage({
      name: 'weather"><img src=x onerror=alert(1)>',
      title: "Weather </script><script>alert(1)</script>",
      version: "1.2.3",
      url: "https://api.example.test/mcp?x=<unsafe>",
      description: "Forecasts <b>without markup</b>",
      iconUrl: "https://cdn.example.test/weather.png?x=<unsafe>",
      tools: [
        {
          name: "forecast",
          title: "Forecast <today>",
          description: "Get <weather>",
        },
      ],
      prompts: [{ name: "trip-plan" }],
      resources: [
        {
          name: "Hidden resource label",
          uri: "climate://<city>",
          description: "Climate <details>",
        },
      ],
    });

    expect(html).toContain("Weather &lt;/script&gt;");
    expect(html).toContain("Forecast &lt;today&gt;");
    expect(html).toContain("climate://&lt;city&gt;");
    expect(html).toContain("Climate &lt;details&gt;");
    expect(html).not.toContain("Hidden resource label");
    expect(html).toContain("weather.png?x=&lt;unsafe&gt;");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Open in Cursor");
    expect(html).toContain("Open in VS Code");
    expect(html).toContain("ChatGPT");
    expect(html).toContain('id="mesh-bg"');
    expect(html).toContain("getContext('webgl2')");
    expect(html).toContain("https://inspector.manufact.com/inspector?");
    expect(html).toContain("https://fonts.googleapis.com/css2?family=Outfit");
    expect(html).toContain(
      "https://img.shields.io/github/stars/mcp-use/mcp-use"
    );
    expect(html).toContain("https://manufact.com");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");

    const jsonLd = html.match(
      /<script type="application\/ld\+json">(.*?)<\/script>/s
    )?.[1];
    expect(jsonLd).toBeDefined();
    expect(JSON.parse(jsonLd!)).toMatchObject({
      name: "Weather </script><script>alert(1)</script>",
      description: "Forecasts <b>without markup</b>",
    });
  });

  it("encodes client install values for their destination contexts", () => {
    const cursorUrl = "https://api.example.test/mcp?x=🔥a";
    const cursorHtml = generateLandingPage({
      name: "install-test",
      version: "1.0.0",
      url: cursorUrl,
    });

    const cursorDeepLink = cursorHtml.match(
      /href="(cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?[^"]+)"/
    )?.[1];
    expect(cursorDeepLink).toBeDefined();
    expect(cursorDeepLink).toContain("%2B");
    expect(cursorDeepLink).toContain("%3D");

    const cursorConfig = new URL(cursorDeepLink!).searchParams.get("config");
    expect(cursorConfig).not.toBeNull();
    expect(
      JSON.parse(Buffer.from(cursorConfig!, "base64").toString("utf8"))
    ).toEqual({ url: cursorUrl });

    const shellUrl = "https://api.example.test/mcp?run=$(touch /tmp/pwned)'";
    const shellHtml = generateLandingPage({
      name: "install-test",
      version: "1.0.0",
      url: shellUrl,
    });
    expect(shellHtml).toContain(
      "claude mcp add --transport http &quot;install-test&quot; &#39;https://api.example.test/mcp?run=$(touch /tmp/pwned)&#39;\\&#39;&#39;&#39;"
    );
  });
});

describe("MCPServer landing page routing", () => {
  it("renders a custom shell with serialized props and caches by URL and asset base", async () => {
    const originalAssetsUrl = process.env["MCP_ASSETS_URL"];
    const server = track(
      new MCPServer({
        name: "custom-landing",
        title: "Custom <Landing>",
        version: "2.0.0",
        websiteUrl: "https://example.test",
      })
    );
    server.tool({ name: "weather", title: "Weather" }, async () => ({
      content: [],
    }));
    const renders: string[] = [];
    server.__primeLandingPage({
      render: (props) => {
        renders.push(props.url);
        expect(props).toMatchObject({
          name: "custom-landing",
          title: "Custom <Landing>",
          websiteUrl: "https://example.test",
          tools: [{ name: "weather", title: "Weather" }],
          prompts: [],
          resources: [],
        });
        return `<main>${props.name}</main>`;
      },
      entry: "assets/entry.js",
      css: ["assets/entry.css"],
    });
    const request = htmlRequest("https://server.example.test/mcp");
    try {
      process.env["MCP_ASSETS_URL"] = "https://cdn-one.example.test/prefix";
      const first = await server.fetch(request);
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(first.headers.get("content-type")).toBe(
        "text/html; charset=utf-8"
      );
      expect(first.headers.get("x-content-type-options")).toBe("nosniff");
      const html = await first.text();
      expect(html).toContain(
        '<div id="mcp-use-landing-root"><main>custom-landing</main></div>'
      );
      expect(html).toContain(
        "https://cdn-one.example.test/prefix/mcp/_mcp-use/landing/assets/entry.js"
      );
      expect(html).toContain(
        "https://cdn-one.example.test/prefix/mcp/_mcp-use/landing/assets/entry.css"
      );
      expect(html).toContain("Custom &lt;Landing&gt;");
      const json = html.match(
        /<script id="mcp-use-landing-props" type="application\/json">(.*?)<\/script>/s
      )?.[1];
      expect(json).toBeDefined();
      expect(JSON.parse(json!)).toMatchObject({
        url: "https://server.example.test/mcp",
        title: "Custom <Landing>",
        publicBaseUrl:
          "https://cdn-one.example.test/prefix/mcp/_mcp-use/public/",
      });
      expect(JSON.parse(json!).tools).toEqual([
        { name: "weather", title: "Weather" },
      ]);

      await server.fetch(request);
      expect(renders).toHaveLength(1);

      process.env["MCP_ASSETS_URL"] = "https://cdn-two.example.test/prefix";
      const second = await server.fetch(request);
      expect(await second.text()).toContain(
        "https://cdn-two.example.test/prefix/mcp/_mcp-use/landing/assets/entry.js"
      );
      expect(renders).toHaveLength(2);

      const head = await server.fetch(
        htmlRequest("https://server.example.test/mcp", { method: "HEAD" })
      );
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(renders).toHaveLength(2);
    } finally {
      if (originalAssetsUrl === undefined) delete process.env["MCP_ASSETS_URL"];
      else process.env["MCP_ASSETS_URL"] = originalAssetsUrl;
    }
  });

  it("serves landing bundles and project public files on a custom base path", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mcp-landing-"));
    directories.push(projectRoot);
    const bundleDir = join(projectRoot, ".mcp-use/build/landing/assets");
    const publicDir = join(projectRoot, ".mcp-use/build/views/public");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(bundleDir, "entry.js"), "export const ready = true;");
    await writeFile(join(publicDir, "logo.svg"), "<svg></svg>");
    const server = track(
      new MCPServer({
        name: "asset-landing",
        version: "1.0.0",
        basePath: "/api/mcp",
      })
    );
    server.__primeLandingPage({
      render: () => "<main>Assets</main>",
      entry: "assets/entry.js",
      projectRoot,
    });
    const bundleUrl =
      "https://server.example.test/api/mcp/_mcp-use/landing/assets/entry.js";
    const asset = await server.fetch(new Request(bundleUrl));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("application/javascript");
    expect(await asset.text()).toBe("export const ready = true;");
    const head = await server.fetch(new Request(bundleUrl, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const publicAsset = await server.fetch(
      new Request(
        "https://server.example.test/api/mcp/_mcp-use/public/logo.svg"
      )
    );
    expect(publicAsset.status).toBe(200);
    expect(await publicAsset.text()).toBe("<svg></svg>");
    const traversal = await server.fetch(
      new Request(
        "https://server.example.test/api/mcp/_mcp-use/landing/%2e%2e/entry.js"
      )
    );
    expect(traversal.status).toBe(404);
  });

  it("serves GET/HEAD HTML at a custom base path and preserves protocol probes", async () => {
    const server = track(
      new MCPServer({
        name: "landing-test",
        title: "Landing Test",
        version: "1.0.0",
        description: "A browser landing page fixture.",
        basePath: "/api/mcp",
      })
    );
    server.tool(
      {
        name: "weather",
        title: "Weather lookup",
        description: "Look up the weather.",
      },
      async () => ({ content: [{ type: "text", text: "sunny" }] })
    );
    server.prompt({ name: "plan", description: "Plan a trip." }, async () => ({
      messages: [],
    }));
    server.resource(
      {
        name: "climate",
        uri: "climate://current",
        description: "Current climate data.",
      },
      async (uri) => ({ contents: [{ uri: uri.href, text: "mild" }] })
    );

    const handler = server.fetch;
    const get = await handler(
      htmlRequest("https://public.example.test/api/mcp")
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(get.headers.get("cache-control")).toBe("no-store");
    const html = await get.text();
    expect(html).toContain("Landing Test");
    expect(html).toContain("https://public.example.test/api/mcp");
    expect(html).toContain("Weather lookup");
    expect(html).toContain("climate://current");

    const head = await handler(
      htmlRequest("https://public.example.test/api/mcp", { method: "HEAD" })
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await head.text()).toBe("");

    for (const accept of ["application/json", "text/event-stream", "*/*"]) {
      const probe = await handler(
        new Request("https://public.example.test/api/mcp", {
          headers: { accept },
        })
      );
      expect(probe.status).toBe(204);
    }

    const missing = await handler(
      htmlRequest("https://public.example.test/api/mcp/sibling")
    );
    expect(missing.status).toBe(404);
    expect(() =>
      server.tool({ name: "late" }, async () => ({ content: [] }))
    ).toThrow(/after the server has started/);
  });

  it("keeps root-base-path URL joining without mounting dev tooling", async () => {
    const server = track(
      new MCPServer({
        name: "root-landing",
        version: "1.0.0",
        basePath: "/",
      })
    );
    const handler = server.fetch;

    const landing = await handler(htmlRequest("https://root.example.test/"));
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain("https://root.example.test/");

    const inspector = await handler(
      htmlRequest("https://root.example.test/inspector")
    );
    expect(inspector.status).toBe(404);
  });

  it("does not bypass configured Host validation", async () => {
    const server = track(
      new MCPServer({
        name: "host-validated-landing",
        version: "1.0.0",
        allowedHosts: ["safe.example.test"],
      })
    );
    const response = await server.fetch(
      new Request("https://evil.example.test/mcp", {
        headers: { accept: "text/html", host: "evil.example.test" },
      })
    );
    expect(response.status).toBe(403);
  });
});

describe("publicLandingPage OAuth behavior", () => {
  function oauthServer(publicLandingPage?: boolean) {
    const resource = "https://api.example.test/mcp";
    return track(
      new MCPServer({
        name: "oauth-landing",
        version: "1.0.0",
        ...(publicLandingPage !== undefined && { publicLandingPage }),
        oauth: oauthProvider(resource),
      })
    );
  }

  it("applies the existing OAuth gate to custom HTML without exposing MCP requests", async () => {
    const protectedServer = oauthServer();
    protectedServer.__primeLandingPage({
      render: () => "<main>Custom OAuth</main>",
      entry: "assets/entry.js",
    });
    const protectedHandler = protectedServer.fetch;
    expect(
      (await protectedHandler(htmlRequest("https://api.example.test/mcp")))
        .status
    ).toBe(401);
    const authorized = await protectedHandler(
      htmlRequest("https://api.example.test/mcp", { token: "valid" })
    );
    expect(await authorized.text()).toContain("Custom OAuth");

    const publicServer = oauthServer(true);
    publicServer.__primeLandingPage({
      render: () => "<main>Public Custom</main>",
      entry: "assets/entry.js",
    });
    const publicHandler = publicServer.fetch;
    const publicHtml = await publicHandler(
      htmlRequest("https://api.example.test/mcp")
    );
    expect(await publicHtml.text()).toContain("Public Custom");
    const protocol = await publicHandler(
      new Request("https://api.example.test/mcp", {
        headers: { accept: "application/json, text/event-stream" },
      })
    );
    expect(protocol.status).toBe(401);
  });

  it("requires OAuth by default but renders HTML after authentication", async () => {
    const handler = oauthServer().fetch;

    const unauthorized = await handler(
      htmlRequest("https://api.example.test/mcp")
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await handler(
      htmlRequest("https://api.example.test/mcp", { token: "valid" })
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain("oauth-landing");

    const authorizedHead = await handler(
      htmlRequest("https://api.example.test/mcp", {
        method: "HEAD",
        token: "valid",
      })
    );
    expect(authorizedHead.status).toBe(200);
    expect(await authorizedHead.text()).toBe("");
  });

  it("makes only negotiated browser GET/HEAD public when enabled", async () => {
    const handler = oauthServer(true).fetch;

    for (const method of ["GET", "HEAD"] as const) {
      const landing = await handler(
        htmlRequest("https://api.example.test/mcp", { method })
      );
      expect(landing.status).toBe(200);
      if (method === "HEAD") {
        expect(await landing.text()).toBe("");
      }
    }

    for (const method of ["GET", "HEAD", "DELETE"] as const) {
      const protocol = await handler(
        new Request("https://api.example.test/mcp", {
          method,
          headers: { accept: "application/json, text/event-stream" },
        })
      );
      expect(protocol.status).toBe(401);
    }

    const post = await handler(
      new Request("https://api.example.test/mcp", {
        method: "POST",
        headers: {
          accept: "text/html",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    expect(post.status).toBe(401);

    const authenticatedProbe = await handler(
      new Request("https://api.example.test/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer valid",
        },
      })
    );
    expect(authenticatedProbe.status).toBe(204);
  });

  it("treats an explicit false value the same as the default", async () => {
    const response = await oauthServer(false).fetch(
      htmlRequest("https://api.example.test/mcp")
    );
    expect(response.status).toBe(401);
  });
});
