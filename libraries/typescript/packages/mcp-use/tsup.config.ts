import { defineConfig } from "tsup";
import type { Options } from "tsup";
import type { Plugin } from "esbuild";

/**
 * Browser build: substitute any import of telemetry-node.{ts,js} with telemetry-browser.
 *
 * mcp_agent.ts and connectors/base.ts are exported from src/browser.ts, so they end
 * up in the browser bundle. Those files correctly import telemetry-node for Node.js
 * semantics, but the browser build must not contain require("node:fs/os/path/crypto").
 * This plugin transparently swaps the implementation at build time.
 */
const telemetryBrowserPlugin: Plugin = {
  name: "telemetry-browser-substitution",
  setup(build) {
    build.onResolve({ filter: /telemetry-node/ }, async (args) => {
      const newPath = args.path.replace("telemetry-node", "telemetry-browser");
      return build.resolve(newPath, {
        resolveDir: args.resolveDir,
        kind: args.kind,
      });
    });
  },
};

const sharedConfig: Partial<Options> = {
  format: ["cjs", "esm"],
  outDir: "dist",
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  external: [
    // Keep MCP SDK external (peer dependency)
    "@modelcontextprotocol/sdk",
    // Keep Tailwind CSS and its dependencies external (native modules)
    "tailwindcss",
    "@tailwindcss/vite",
    "@tailwindcss/oxide",
    // Keep Vite and React plugin external (optional peer dependencies)
    "vite",
    "@vitejs/plugin-react",
    // Keep Connect middleware dependencies external (optional dependencies, dynamically imported)
    "connect",
    "node-mocks-http",
    // Keep Langchain packages external to reduce memory usage during build
    "@langchain/core",
    "@langchain/anthropic",
    "@langchain/openai",
    "langchain",
    "@langfuse/langchain",
    // Keep optional display dependencies external (uses Node.js built-ins, incompatible with neutral platform)
    "chalk",
    "cli-highlight",
    "supports-color",
    // Keep react-router-dom external (optional, for widgets)
    "react-router-dom",
    // Keep Redis external (optional dependency, uses Node.js built-ins)
    "redis",
    "@redis/client",
    // Keep posthog-node external for browser builds (browser uses posthog-js)
    "posthog-node",
  ],
};

export default defineConfig([
  // ── Node.js / server entries ────────────────────────────────────────────────
  // These import telemetry-node.ts directly and must NOT have the substitution
  // plugin, so server code gets real PostHog-node + Scarf tracking.
  {
    ...sharedConfig,
    entry: [
      "index.ts",
      "src/adapters/index.ts",
      "src/agents/index.ts",
      "src/auth/index.ts",
      "src/bin.ts",
      "src/client.ts",
      "src/server/index.ts",
      "src/utils/index.ts",
      "src/client/prompts.ts",
    ],
    esbuildOptions(options) {
      // Preserve node: prefix for Deno compatibility
      options.platform = "neutral";
    },
  },

  // ── Browser entries ─────────────────────────────────────────────────────────
  // mcp_agent.ts and connectors/base.ts (exported from src/browser.ts) import
  // telemetry-node.ts. The plugin below substitutes that with telemetry-browser
  // at build time so the browser bundle contains zero Node.js built-in calls.
  //
  // Use object entry syntax to preserve the src/ prefix in output paths so that
  // dist/src/browser.js and dist/src/react/index.js match package.json exports.
  {
    ...sharedConfig,
    entry: {
      "src/browser": "src/browser.ts",
      "src/react/index": "src/react/index.ts",
    },
    esbuildPlugins: [telemetryBrowserPlugin],
    esbuildOptions(options) {
      // Preserve node: prefix for Deno compatibility
      options.platform = "neutral";
    },
  },
]);
