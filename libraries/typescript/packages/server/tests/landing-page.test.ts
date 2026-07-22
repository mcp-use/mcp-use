import { afterEach, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import { generateLandingPage } from "../src/landing.js";
import { oauthCustomProvider, type OAuthMetadata } from "../src/oauth/index.js";

const servers: MCPServer<unknown>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
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

    const handler = server.getHandler();
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
    const handler = server.getHandler();

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
    const response = await server.getHandler()(
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

  it("requires OAuth by default but renders HTML after authentication", async () => {
    const handler = oauthServer().getHandler();

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
    const handler = oauthServer(true).getHandler();

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
    const response = await oauthServer(false).getHandler()(
      htmlRequest("https://api.example.test/mcp")
    );
    expect(response.status).toBe(401);
  });
});
