import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

const clientPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../client/package.json"), "utf-8")
);

/**
 * CDN bundle build config.
 *
 * Produces a single self-contained ESM file at dist/cdn/inspector.js with all
 * CSS injected at runtime. Published with the npm package and served from
 * inspector-cdn.mcp-use.com — mountInspector() loads it via a <script type="module">
 * tag in a minimal inline HTML shell, so the JS runs in the correct origin context
 * and all /inspector/api/* calls remain same-origin.
 *
 * Dev mode (VITE_DEV=true) proxies to the Vite dev server as before; this
 * bundle is only used in production.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    process.env.ANALYZE === "true" &&
      visualizer({
        filename: "dist/cdn/stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
    conditions: ["browser", "module", "import", "default"],
  },
  define: {
    "process.env": "{}",
    "process.platform": '"browser"',
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(clientPackageJson.version),
    global: "globalThis",
  },
  optimizeDeps: {
    include: [
      "@mcp-use/client",
      "@mcp-use/client/react",
      "@mcp-use/agent",
      "react-dom",
    ],
  },
  build: {
    lib: {
      entry: "src/client/main.tsx",
      formats: ["es"],
      // Explicit .js suffix — Vite lib mode omits the extension when fileName
      // is a function, so we include it explicitly for browser <script type="module">.
      fileName: () => "inspector.js",
    },
    outDir: "dist/cdn",
    minify: true,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
      external: [
        "langfuse-langchain",
        "langfuse",
        "@e2b/code-interpreter",
        "os",
      ],
    },
  },
});
