import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    // Plugin to ignore Node.js-only dynamic imports
    {
      name: "ignore-node-modules",
      resolveId(id) {
        // Mark Node.js-only modules as external to prevent bundling
        if (id === "posthog-node") {
          return { id, external: true };
        }
        return null;
      },
    },
  ],
  build: {
    outDir: "dist",
    commonjsOptions: {
      transformMixedEsModules: true,
      ignore: ["posthog-node"],
    },
    rollupOptions: {
      external: ["posthog-node"],
    },
  },
  resolve: {
    alias: {
      "mcp-use/browser": resolve(__dirname, "../../../dist/src/browser.js"),
      "mcp-use/react": resolve(__dirname, "../../../dist/src/react/index.js"),
    },
    conditions: ["browser", "module", "import", "default"],
  },
  define: {
    global: "globalThis",
    "process.env.DEBUG": "undefined",
    "process.env.MCP_USE_ANONYMIZED_TELEMETRY": "undefined",
    "process.env.MCP_USE_TELEMETRY_SOURCE": "undefined",
    "process.env.MCP_USE_LANGFUSE": "undefined",
    "process.platform": '""',
    "process.version": '""',
    "process.argv": "[]",
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
    exclude: ["posthog-node"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
      plugins: [],
    },
  },
});
