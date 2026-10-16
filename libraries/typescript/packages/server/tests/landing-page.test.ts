import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MCPServer } from "../src/index.js";
import {
  generateLandingPage,
  getInstallTargets,
  type LandingData,
  type LandingDataKey,
} from "../src/landing.js";
import { oauthCustomProvider, type OAuthMetadata } from "../src/oauth/index.js";
import { createLandingAssetsHandler } from "../src/views/routes.js";

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

  it("takes its install links and steps from getInstallTargets", () => {
    const html = generateLandingPage({
      name: "weather",
      version: "1.0.0",
      url: "https://example.com/mcp",
    });
    const install = getInstallTargets({
      url: "https://example.com/mcp",
      name: "weather",
    });

    expect(html).toContain(
      `<a href="${install.cursor.deeplink}" class="install-btn">Open in Cursor</a>`
    );
    expect(html).toContain(
      `<a href="${install.vscode.deeplink}" class="install-btn">Open in VS Code</a>`
    );
    expect(html).toContain(
      `<a href="${install.vscodeInsiders.deeplink}" class="install-btn">Open in VS Code Insiders</a>`
    );
    expect(html).toContain(
      `<pre data-copy="claude mcp add --transport http &quot;weather&quot; &#39;https://example.com/mcp&#39;">`
    );
    expect(html).toContain(
      `<a id="inspector-link" href="https://inspector.manufact.com/inspector?autoConnect=https%3A%2F%2Fexample.com%2Fmcp&amp;tab=chat"`
    );
    expect(html).toContain(`<ol class="steps">
          <li><strong>Open Plugins:</strong> In ChatGPT, go to Plugins and click Add</li>
          <li><strong>Add this MCP server:</strong> Choose Add Custom MCP Server and enter https://example.com/mcp</li>
          <li><strong>Use in conversations:</strong> Choose the MCP server from the Plus menu</li>
        </ol>`);
  });

  it("names install targets after the title when one is set", () => {
    const html = generateLandingPage({
      name: "weather",
      title: "Weather Service",
      version: "1.0.0",
      url: "https://example.com/mcp",
    });
    const { cursor } = getInstallTargets({
      url: "https://example.com/mcp",
      name: "Weather Service",
    });
    expect(html).toContain(`href="${cursor.deeplink}"`);
    expect(html).toContain("&quot;weather_service&quot;");
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
  it("renders a custom shell with serialized data and caches by URL and asset base", async () => {
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
      render: (data) => {
        renders.push(data.server.url);
        expect(data).toMatchObject({
          server: {
            name: "custom-landing",
            title: "Custom <Landing>",
            version: "2.0.0",
            websiteUrl: "https://example.test",
          },
          tools: [{ name: "weather", title: "Weather" }],
          prompts: [],
          resources: [],
        });
        return `<main>${data.server.name}</main>`;
      },
      dataKeys: ["tools", "prompts", "resources"],
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
        /<script id="mcp-use-landing-data" type="application\/json">(.*?)<\/script>/s
      )?.[1];
      expect(json).toBeDefined();
      expect(JSON.parse(json!)).toEqual({
        server: {
          name: "custom-landing",
          title: "Custom <Landing>",
          version: "2.0.0",
          url: "https://server.example.test/mcp",
          websiteUrl: "https://example.test",
          publicBaseUrl:
            "https://cdn-one.example.test/prefix/mcp/_mcp-use/public/",
        },
        tools: [{ name: "weather", title: "Weather" }],
        prompts: [],
        resources: [],
      });
      expect(json).not.toContain("<");

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

  it("renders and serializes only the lists named by dataKeys", async () => {
    const server = track(
      new MCPServer({ name: "keyed-landing", version: "1.0.0" })
    );
    server.tool(
      { name: "weather", description: "Ends </script><script>alert(1)" },
      async () => ({ content: [] })
    );
    server.prompt({ name: "plan" }, async () => ({ messages: [] }));
    let rendered: LandingData | undefined;
    server.__primeLandingPage({
      render: (data) => {
        rendered = data;
        return "<main>Keyed</main>";
      },
      dataKeys: ["tools"],
      entry: "assets/entry.js",
    });
    const html = await (
      await server.fetch(htmlRequest("https://server.example.test/mcp"))
    ).text();
    const json = html.match(
      /<script id="mcp-use-landing-data" type="application\/json">(.*?)<\/script>/s
    )?.[1];
    expect(json).toBeDefined();
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json!)).toEqual({
      server: {
        name: "keyed-landing",
        version: "1.0.0",
        url: "https://server.example.test/mcp",
        publicBaseUrl: "https://server.example.test/mcp/_mcp-use/public/",
      },
      tools: [
        { name: "weather", description: "Ends </script><script>alert(1)" },
      ],
    });
    expect(rendered).toEqual(JSON.parse(json!));
  });

  it("loads the page before every uncached render and keeps its keys with its renderer", async () => {
    const server = track(
      new MCPServer({ name: "live-keys-landing", version: "1.0.0" })
    );
    server.tool({ name: "weather" }, async () => ({ content: [] }));
    server.prompt({ name: "plan" }, async () => ({ messages: [] }));
    const keys: LandingDataKey[][] = [["prompts"], []];
    const rendered: { version: number; data: LandingData }[] = [];
    let loads = 0;
    server.__primeLandingPage({
      load: async () => {
        const version = ++loads;
        return {
          dataKeys: keys.shift() ?? [],
          render: (data) => {
            rendered.push({ version, data });
            return "<main>Live</main>";
          },
        };
      },
      entry: "assets/entry.js",
      dev: true,
    });
    const request = htmlRequest("https://server.example.test/mcp");
    await Promise.all([server.fetch(request), server.fetch(request)]);
    expect(
      rendered
        .map(({ version, data }) => [version, Object.keys(data).sort()])
        .sort()
    ).toEqual([
      [1, ["prompts", "server"]],
      [2, ["server"]],
    ]);
    expect(rendered.find(({ version }) => version === 1)?.data.prompts).toEqual(
      [{ name: "plan" }]
    );
  });

  describe("metadata", () => {
    /** Render a custom page whose module exported `metadata`. */
    async function renderHead(
      metadata: unknown,
      config: { title?: string; description?: string } = {}
    ): Promise<string> {
      const server = track(
        new MCPServer({ name: "meta-landing", version: "1.0.0", ...config })
      );
      server.__primeLandingPage({
        render: () => "<main>Meta</main>",
        dataKeys: [],
        metadata,
        entry: "assets/entry.js",
      });
      const html = await (
        await server.fetch(htmlRequest("https://server.example.test/mcp"))
      ).text();
      return html.slice(0, html.indexOf("</head>"));
    }

    const defaultTitle =
      "Meta MCP Server — Connect with Claude Code, Cursor &amp; VS Code";
    const defaultDescription = "A server with a description.";

    it("keeps the default head when the page exports no metadata", async () => {
      for (const metadata of [undefined, {}, { title: "", image: "" }]) {
        const head = await renderHead(metadata, {
          title: "Meta",
          description: defaultDescription,
        });
        expect(head).toContain(`<title>${defaultTitle}</title>`);
        expect(head).toContain(
          `<meta name="description" content="${defaultDescription}">`
        );
        expect(head).toContain(
          `<meta property="og:title" content="${defaultTitle}">`
        );
        expect(head).toContain(
          `<meta name="twitter:description" content="${defaultDescription}">`
        );
        expect(head).toContain('<meta name="twitter:card" content="summary">');
        expect(head).not.toContain("og:image");
        expect(head).not.toContain("twitter:image");
        expect(head).not.toContain('rel="icon"');
      }
    });

    it("uses the title for the title and Open Graph and Twitter titles", async () => {
      const head = await renderHead(
        { title: "Acme for Claude" },
        { description: defaultDescription }
      );
      expect(head).toContain("<title>Acme for Claude</title>");
      expect(head).toContain(
        '<meta property="og:title" content="Acme for Claude">'
      );
      expect(head).toContain(
        '<meta name="twitter:title" content="Acme for Claude">'
      );
      expect(head).toContain(
        `<meta name="description" content="${defaultDescription}">`
      );
    });

    it("uses the description for the meta, Open Graph, Twitter, and JSON-LD descriptions", async () => {
      const head = await renderHead({ description: "Connect Acme." });
      expect(head).toContain(
        '<meta name="description" content="Connect Acme.">'
      );
      expect(head).toContain(
        '<meta property="og:description" content="Connect Acme.">'
      );
      expect(head).toContain(
        '<meta name="twitter:description" content="Connect Acme.">'
      );
      expect(head).toContain('"description":"Connect Acme."');
      expect(head).toContain(
        "<title>meta-landing MCP Server — Connect with Claude Code, Cursor &amp; VS Code</title>"
      );
    });

    it("resolves the icon under public/ unless it is an absolute URL", async () => {
      const publicBase = "https://server.example.test/mcp/_mcp-use/public";
      for (const [icon, href] of [
        ["brand/icon.svg", `${publicBase}/brand/icon.svg`],
        ["/icon.png", `${publicBase}/icon.png`],
        ["//cdn.example.test/icon.png", "https://cdn.example.test/icon.png"],
        [
          "https://cdn.example.test/icon.png",
          "https://cdn.example.test/icon.png",
        ],
        ["data:image/svg+xml,%3Csvg%3E", "data:image/svg+xml,%3Csvg%3E"],
      ]) {
        const head = await renderHead({ icon });
        expect(head).toContain(`<link rel="icon" href="${href}">`);
      }
    });

    it("replaces the branding favicon with the metadata icon", async () => {
      const server = track(
        new MCPServer({
          name: "branded-meta-landing",
          version: "1.0.0",
          favicon: "data:image/png;base64,iVBORw0KGgo=",
        })
      );
      server.__primeLandingPage({
        render: () => "<main>Meta</main>",
        dataKeys: [],
        metadata: { icon: "icon.svg" },
        entry: "assets/entry.js",
      });
      const html = await (
        await server.fetch(htmlRequest("https://server.example.test/mcp"))
      ).text();
      expect(html.match(/rel="icon"/g)).toHaveLength(1);
      expect(html).toContain(
        '<link rel="icon" href="https://server.example.test/mcp/_mcp-use/public/icon.svg">'
      );
    });

    it("adds Open Graph and Twitter images and a large Twitter card for the image", async () => {
      const head = await renderHead({ image: "og.png" });
      const image = "https://server.example.test/mcp/_mcp-use/public/og.png";
      expect(head).toContain(`<meta property="og:image" content="${image}">`);
      expect(head).toContain(`<meta name="twitter:image" content="${image}">`);
      expect(head).toContain(
        '<meta name="twitter:card" content="summary_large_image">'
      );
    });

    it("HTML-escapes every metadata value", async () => {
      const attack = `"><script>alert('x')</script>&`;
      const escaped =
        "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;";
      const head = await renderHead({
        title: attack,
        description: attack,
        icon: `https://cdn.example.test/${attack}`,
        image: `https://cdn.example.test/${attack}`,
      });
      expect(head).not.toContain("<script>alert");
      expect(head).toContain(`<title>${escaped}</title>`);
      expect(head).toContain(`<meta name="description" content="${escaped}">`);
      expect(head).toContain(
        `<link rel="icon" href="https://cdn.example.test/${escaped}">`
      );
      expect(head).toContain(
        `<meta property="og:image" content="https://cdn.example.test/${escaped}">`
      );
      // The JSON-LD script cannot be closed by the description.
      expect(head).toContain('"description":"\\"\\u003e\\u003cscript\\u003e');
    });

    it("ignores metadata that is not an object, and fields that are not strings, with a warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const nonObject = await renderHead("Acme");
        expect(nonObject).toContain(
          "<title>meta-landing MCP Server — Connect with Claude Code, Cursor &amp; VS Code</title>"
        );
        const partial = await renderHead({
          title: 42,
          description: "Still used.",
          icon: { href: "icon.svg" },
          image: null,
        });
        expect(partial).toContain(
          "<title>meta-landing MCP Server — Connect with Claude Code, Cursor &amp; VS Code</title>"
        );
        expect(partial).toContain(
          '<meta name="description" content="Still used.">'
        );
        expect(partial).not.toContain('rel="icon"');
        expect(partial).not.toContain("og:image");
        expect(warn.mock.calls.map(([message]) => message)).toEqual([
          "[mcp-use] landing.tsx metadata: expected an object, got string; ignoring it.",
          "[mcp-use] landing.tsx metadata: title must be a string, got number; ignoring it.",
          "[mcp-use] landing.tsx metadata: icon must be a string, got object; ignoring it.",
          "[mcp-use] landing.tsx metadata: image must be a string, got null; ignoring it.",
        ]);
      } finally {
        warn.mockRestore();
      }
    });

    it("ignores an icon or image that is not a valid URL or public path, with a warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const head = await renderHead({
          title: "Kept",
          icon: "\\\\",
          image: "/\\\\",
        });
        expect(head).toContain("<title>Kept</title>");
        expect(head).not.toContain('rel="icon"');
        expect(head).not.toContain("og:image");
        expect(head).toContain('<meta name="twitter:card" content="summary">');
        expect(warn.mock.calls.map(([message]) => message)).toEqual([
          "[mcp-use] landing.tsx metadata: icon is not a valid URL or public path; ignoring it.",
          "[mcp-use] landing.tsx metadata: image is not a valid URL or public path; ignoring it.",
        ]);
      } finally {
        warn.mockRestore();
      }
    });

    it("reads the metadata of each development load", async () => {
      const server = track(
        new MCPServer({ name: "live-meta-landing", version: "1.0.0" })
      );
      const titles = ["First", "Second"];
      server.__primeLandingPage({
        load: async () => ({
          dataKeys: [],
          metadata: { title: titles.shift() },
          render: () => "<main>Live</main>",
        }),
        entry: "assets/entry.js",
        dev: true,
      });
      const request = htmlRequest("https://server.example.test/mcp");
      expect(await (await server.fetch(request)).text()).toContain(
        "<title>First</title>"
      );
      expect(await (await server.fetch(request)).text()).toContain(
        "<title>Second</title>"
      );
    });
  });

  it("rejects a registration without data keys", () => {
    const server = track(
      new MCPServer({ name: "keyless-landing", version: "1.0.0" })
    );
    expect(() =>
      server.__primeLandingPage({
        render: () => "<main>Keyless</main>",
        entry: "assets/entry.js",
      } as unknown as Parameters<typeof server.__primeLandingPage>[0])
    ).toThrow(TypeError);
    expect(() =>
      server.__primeLandingPage({
        load: "not a function",
        entry: "assets/entry.js",
      } as unknown as Parameters<typeof server.__primeLandingPage>[0])
    ).toThrow(TypeError);
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
      dataKeys: [],
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
  });

  it("rejects encoded traversal out of the landing bundle directory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mcp-landing-"));
    directories.push(projectRoot);
    const bundleDir = join(projectRoot, ".mcp-use/build/landing/assets");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "entry.js"), "export {};");
    await writeFile(join(projectRoot, ".mcp-use/build/secret.txt"), "secret");
    const handler = createLandingAssetsHandler("/mcp", { projectRoot });

    const served = await handler(
      new Request(
        "https://server.example.test/mcp/_mcp-use/landing/assets/entry.js"
      )
    );
    expect(served.status).toBe(200);
    // `%2f` survives URL parsing, so only the handler's own decoding and
    // segment checks keep this inside `.mcp-use/build/landing/`.
    for (const path of ["..%2fsecret.txt", "assets%2f..%2f..%2fsecret.txt"]) {
      const response = await handler(
        new Request(`https://server.example.test/mcp/_mcp-use/landing/${path}`)
      );
      expect(response.status).toBe(404);
    }
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
      dataKeys: [],
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
      dataKeys: [],
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
