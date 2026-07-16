import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { hasNoOpenFlag, parsePortFromArgs } from "./src/server/utils.js";
import { inspectorDevApiPlugin } from "./src/server/vite-dev-api-plugin.js";

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);
const clientPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../client/package.json"), "utf-8")
);

const devPort =
  parsePortFromArgs() ??
  (Number(process.env.INSPECTOR_PORT) || 3000);

export default defineConfig({
  base: "/inspector",
  plugins: [
    react(),
    tailwindcss(),
    inspectorDevApiPlugin(),
    {
      name: "inspector-dev-banner",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          const addr = server.httpServer?.address();
          const port =
            typeof addr === "object" && addr ? addr.port : devPort;
          console.log(
            `\n🚀 MCP Inspector running on http://localhost:${port}/inspector`
          );
          console.log(
            "📡 Proxy request logs appear below when you connect to an MCP server\n"
          );
        });
      },
    },
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
    // Mirror MANUFACT_CHAT_URL / VITE_MANUFACT_CHAT_URL into window for parity
    // with the CDN shell (cli.ts injects the same flag at runtime).
    {
      name: "inject-manufact-chat-url",
      transformIndexHtml() {
        const url =
          process.env.MANUFACT_CHAT_URL ??
          process.env.VITE_MANUFACT_CHAT_URL;
        if (!url) return [];
        return [
          {
            tag: "script",
            children: `window.__MANUFACT_CHAT_URL__ = ${JSON.stringify(url)};`,
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
    },
    conditions: ["browser", "module", "import", "default"],
  },
  define: {
    "process.env": "{}",
    "process.platform": '"browser"',
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(clientPackageJson.version),
    // Ensure global is defined
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["@mcp-use/client", "@mcp-use/client/react", "@mcp-use/agent"],
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
    port: devPort,
    strictPort: true,
    host: true,
    open: hasNoOpenFlag() ? false : "/inspector",
  },
});
