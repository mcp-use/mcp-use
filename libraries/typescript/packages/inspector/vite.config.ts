import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);
const clientPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../client/package.json"), "utf-8")
);

export default defineConfig({
  base: "/inspector",
  plugins: [
    react(),
    tailwindcss(),
    // Custom plugin to inject version into HTML
    {
      name: "inject-version",
      transformIndexHtml(html) {
        return html.replace(
          "</head>",
          `  <script>window.__INSPECTOR_VERSION__ = "${packageJson.version}";</script>\n  </head>`
        );
      },
    },
    // Mirror MCP_USE_ANONYMIZED_TELEMETRY=false into a per-page window flag so
    // the env-var opt-out works in pure-Vite dev mode too (the inspector
    // backend's `injectRuntimeConfig` never runs when Vite serves directly).
    {
      name: "inject-telemetry-opt-out",
      transformIndexHtml() {
        if (process.env.MCP_USE_ANONYMIZED_TELEMETRY !== "false") return [];
        return [
          {
            tag: "script",
            children: "window.__MCP_USE_ANONYMIZED_TELEMETRY__ = false;",
            injectTo: "head-prepend",
          },
        ];
      },
    },
    // Custom plugin to handle OAuth callback redirects in dev mode
    {
      name: "oauth-callback-redirect",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/oauth/callback")) {
            const url = new URL(req.url, "http://localhost");
            const queryString = url.search;
            res.writeHead(302, {
              Location: `/inspector/oauth/callback${queryString}`,
            });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    // Ensure a single React instance even when deps resolve to different minor versions.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@mcp-use/client/react": path.resolve(
        __dirname,
        "../client/src/react/index.ts"
      ),
      // The root client export selects the browser-safe build in Vite.
      "@mcp-use/client": path.resolve(
        __dirname,
        "../client/dist/index-browser.js"
      ),
      "@mcp-use/agent": path.resolve(__dirname, "../agent/src/index.ts"),
    },
    conditions: ["browser", "module", "import", "default"],
  },
  define: {
    "process.env": "{}",
    "process.platform": '"browser"',
    // Inject version from package.json at build time
    __INSPECTOR_VERSION__: JSON.stringify(packageJson.version),
    // @mcp-use/client/react resolves to source in dev; version.ts needs this.
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(clientPackageJson.version),
    // Ensure global is defined
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["@mcp-use/client"],
  },
  build: {
    minify: true,
    outDir: "dist/web",
    rolldownOptions: {
      external: [
        "langfuse-langchain",
        "langfuse",
        "@e2b/code-interpreter",
        "os",
      ],
    },
  },
  server: {
    port: 3000,
    host: true, // Allow external connections
    proxy: {
      // Proxy API requests to the backend server
      "^/inspector/api/.*": {
        target: "http://localhost:3001",
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Preserve the original host for OAuth resource URL rewriting
            const originalHost = req.headers.host || "localhost:3000";
            proxyReq.setHeader("X-Forwarded-Host", originalHost);
          });
        },
      },
    },
  },
});
