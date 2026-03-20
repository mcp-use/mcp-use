import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

const stubDir = path.resolve(__dirname, "src/client/stubs");

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
    {
      name: "inject-version",
      // In lib mode transformIndexHtml is not called; inject via define instead.
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
      "posthog-node": path.resolve(stubDir, "posthog-node.js"),
      "@scarf/scarf": path.resolve(stubDir, "@scarf/scarf.js"),
      dotenv: path.resolve(stubDir, "dotenv.js"),
      util: path.resolve(stubDir, "util.js"),
      path: path.resolve(stubDir, "path.js"),
      process: path.resolve(stubDir, "process.js"),
      "node:fs/promises": path.resolve(stubDir, "fs-promises.js"),
      "fs/promises": path.resolve(stubDir, "fs-promises.js"),
      "node:fs": path.resolve(stubDir, "fs.js"),
      fs: path.resolve(stubDir, "fs.js"),
      "node:async_hooks": path.resolve(stubDir, "async_hooks.js"),
      "node:stream": path.resolve(stubDir, "stream.js"),
      "node:process": path.resolve(stubDir, "process.js"),
      "node:child_process": path.resolve(stubDir, "child_process.js"),
      child_process: path.resolve(stubDir, "child_process.js"),
      "@modelcontextprotocol/sdk/client/stdio.js": path.resolve(
        stubDir,
        "stdio-transport.js"
      ),
      "@modelcontextprotocol/sdk/client/stdio": path.resolve(
        stubDir,
        "stdio-transport.js"
      ),
    },
  },
  define: {
    "process.env": "{}",
    "process.platform": '"browser"',
    __INSPECTOR_VERSION__: JSON.stringify(packageJson.version),
    global: "globalThis",
  },
  optimizeDeps: {
    include: [
      "mcp-use/react",
      "mcp-use/browser",
      "mcp-use/utils",
      "react-syntax-highlighter",
    ],
    exclude: ["posthog-node", "tar", "path-scurry"],
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
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
      external: [
        "langfuse-langchain",
        "langfuse",
        "@e2b/code-interpreter",
        "os",
      ],
      onwarn(warning, warn) {
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
  ssr: {
    noExternal: ["react-syntax-highlighter", "refractor"],
  },
});
