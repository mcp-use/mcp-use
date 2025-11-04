import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  resolve: {
    alias: {
      "mcp-use/browser": resolve(__dirname, "../../../dist/src/browser.js"),
      "mcp-use/react": resolve(__dirname, "../../../dist/src/react/index.js"),
    },
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
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
      plugins: [],
    },
  },
});
