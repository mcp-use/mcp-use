import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import { INSPECTOR_FAVICON_ASSETS } from "./src/server/favicon-links";

const inspectorPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

/**
 * Packaged Inspector application build config.
 *
 * Produces the `dist/app` browser bundle shipped inside the npm package.
 * `mountInspector` and the standalone CLI serve these files from their own
 * listener; no external application asset host is involved.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-favicon-assets",
      closeBundle() {
        const publicDir = path.resolve(__dirname, "public");
        const outDir = path.resolve(__dirname, "dist/app");
        mkdirSync(outDir, { recursive: true });
        for (const file of INSPECTOR_FAVICON_ASSETS) {
          copyFileSync(path.join(publicDir, file), path.join(outDir, file));
        }
      },
    },
    process.env.ANALYZE === "true" &&
      visualizer({
        filename: "dist/app/stats.html",
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
    __MCP_USE_PACKAGE_VERSION__: JSON.stringify(inspectorPackageJson.version),
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
  preview: {
    // Permit previewing the package bundle from local integration fixtures.
    cors: true,
  },
  build: {
    lib: {
      entry: "src/client/main.tsx",
      formats: ["es"],
      // Explicit .js suffix — Vite lib mode omits the extension when fileName
      // is a function, so we include it explicitly for browser <script type="module">.
      fileName: () => "inspector.js",
    },
    outDir: "dist/app",
    minify: true,
    rolldownOptions: {
      external: [
        "langfuse-langchain",
        "langfuse",
        "@e2b/code-interpreter",
        "os",
      ],
    },
  },
});
