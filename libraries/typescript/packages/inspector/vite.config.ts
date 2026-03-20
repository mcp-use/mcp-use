import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
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
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Use require.resolve to get the actual module path from node_modules
      // This works in both dev (with workspace links) and production
      "mcp-use/react": path.resolve(
        __dirname,
        "../mcp-use/dist/src/react/index.js"
      ),
      "mcp-use/browser": path.resolve(
        __dirname,
        "../mcp-use/dist/src/browser.js"
      ),
      "mcp-use/utils": path.resolve(
        __dirname,
        "../mcp-use/dist/src/utils/index.js"
      ),
      "posthog-node": path.resolve(
        __dirname,
        "./src/client/stubs/posthog-node.js"
      ),
      "@scarf/scarf": path.resolve(
        __dirname,
        "./src/client/stubs/@scarf/scarf.js"
      ),
      dotenv: path.resolve(__dirname, "./src/client/stubs/dotenv.js"),
      util: path.resolve(__dirname, "./src/client/stubs/util.js"),
      path: path.resolve(__dirname, "./src/client/stubs/path.js"),
      process: path.resolve(__dirname, "./src/client/stubs/process.js"),
      // More specific aliases must come first
      "node:fs/promises": path.resolve(
        __dirname,
        "./src/client/stubs/fs-promises.js"
      ),
      "fs/promises": path.resolve(
        __dirname,
        "./src/client/stubs/fs-promises.js"
      ),
      "node:fs": path.resolve(__dirname, "./src/client/stubs/fs.js"),
      fs: path.resolve(__dirname, "./src/client/stubs/fs.js"),
      "node:async_hooks": path.resolve(
        __dirname,
        "./src/client/stubs/async_hooks.js"
      ),
      "node:stream": path.resolve(__dirname, "./src/client/stubs/stream.js"),
      "node:process": path.resolve(__dirname, "./src/client/stubs/process.js"),
      "node:child_process": path.resolve(
        __dirname,
        "./src/client/stubs/child_process.js"
      ),
      child_process: path.resolve(
        __dirname,
        "./src/client/stubs/child_process.js"
      ),
    },
  },
  define: {
    // Define process.env for browser compatibility
    "process.env": "{}",
    "process.platform": '"browser"',
    // Inject version from package.json at build time
    __INSPECTOR_VERSION__: JSON.stringify(packageJson.version),
    // Ensure global is defined
    global: "globalThis",
  },
  optimizeDeps: {
    include: [
      "mcp-use/react",
      "mcp-use/browser",
      "mcp-use/utils",
      "react-syntax-highlighter",
    ],
    exclude: [
      "posthog-node",
      "tar", // Node.js file system package
      "path-scurry", // Node.js path utilities
    ], // Exclude Node.js-only packages
  },
  ssr: {
    noExternal: ["react-syntax-highlighter", "refractor"],
  },
  build: {
    minify: true,
    outDir: "dist/web",
    rollupOptions: {
      external: [
        "langfuse-langchain",
        "langfuse",
        "@e2b/code-interpreter",
        "os",
      ],
      onwarn(warning, warn) {
        // Suppress warnings about externalized modules for refractor
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          warning.exporter?.includes("refractor")
        ) {
          return;
        }
        warn(warning);
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
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
