import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const clientDist = resolve(__dirname, "../../../dist");

export default defineConfig({
  server: {
    proxy: {
      "/demo/mcp-use-v2": {
        target: "http://127.0.0.1:3104",
        changeOrigin: true,
        rewrite: () => "/mcp",
      },
    },
  },
  plugins: [
    react(),
    {
      name: "ignore-node-modules",
      resolveId(id) {
        if (id === "posthog-node") {
          return { id, external: true };
        }
        return null;
      },
    },
  ],
  build: {
    outDir: "dist",
    rolldownOptions: {
      external: ["posthog-node"],
    },
  },
  resolve: {
    alias: [
      {
        find: "@mcp-use/client/react",
        replacement: resolve(clientDist, "react/index.js"),
      },
      {
        find: "@mcp-use/client",
        replacement: resolve(clientDist, "index-browser.js"),
      },
      {
        find: "mcp-use/react",
        replacement: resolve(clientDist, "react/index.js"),
      },
    ],
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
    rolldownOptions: {
      transform: {
        define: {
          global: "globalThis",
        },
      },
    },
  },
});
