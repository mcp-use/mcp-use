import { readFileSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

const frameworkPackage = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

const packageVersionDefine = {
  __MCP_USE_PACKAGE_VERSION__: JSON.stringify(frameworkPackage.version),
};

// Every build must use the same module-local response/request identity maps.
// A private package import shares them without exposing mutable global state.
const sharedBufferedResponse: Options["esbuildPlugins"] = [
  {
    name: "shared-buffered-response",
    setup(build) {
      build.onResolve({ filter: /(?:^|\/)buffered-response\.js$/ }, () => ({
        path: "#mcp-use-buffered-response",
        external: true,
      }));
    },
  },
];

function minifyFrameworkOutput(options: {
  minifySyntax?: boolean;
  minifyWhitespace?: boolean;
  minifyIdentifiers?: boolean;
}): void {
  options.minifySyntax = true;
  options.minifyWhitespace = true;
  options.minifyIdentifiers = false;
}

export default defineConfig([
  {
    entry: {
      // OAuth subpath exports mirror tsc's rootDir:src layout so generated JS
      // and declarations stay aligned with package.json's exports map.
      "oauth/index": "src/oauth/index.ts",
      "oauth/clerk": "src/oauth/clerk.ts",
      "oauth/auth0": "src/oauth/auth0.ts",
      "oauth/workos": "src/oauth/workos.ts",
      "oauth/supabase": "src/oauth/supabase.ts",
      "oauth/keycloak": "src/oauth/keycloak.ts",
      "oauth/better-auth": "src/oauth/better-auth.ts",
      "oauth/scalekit": "src/oauth/scalekit.ts",
      "oauth/convex": "src/oauth/convex.ts",
      // Keep the OpenAPI integration in a sibling chunk. `MCPServer` imports
      // it synchronously so `fromOpenAPI()` stays a synchronous constructor,
      // while the root entry retains its independently enforced size budget.
      "openapi/index": "src/openapi/index.ts",
      // Landing markup stays lazy on the MCP path and directly importable
      // from `mcp-use/landing` without inflating the root runtime entry.
      landing: "src/landing.ts",
      // Completion normalization is a synchronous internal dependency kept
      // outside the root entry's independently enforced size budget.
      "internal/resource-completion": "src/resource-completion.ts",
      // Internal-only validation entry; absent from package exports.
      "internal/usage": "src/usage.ts",
      "internal/buffered-response": "src/buffered-response.ts",
      // Runtime-only binary: owns `mcp-use start` and delegates development
      // commands to the separately installed @mcp-use/cli package.
      bin: "src/bin.ts",
      "node-bridge": "src/node-bridge.ts",
      "internal/node-http": "src/node-http.ts",
      "internal/node-http-unavailable": "src/node-http-unavailable.ts",
      "internal/skills-loader-unavailable":
        "src/skills/node-loader-unavailable.ts",
      "next/index": "src/next/index.ts",
      "tanstack-start/index": "src/tanstack-start/index.ts",
      "tanstack-start/vite": "src/tanstack-start/vite.ts",
      "vite/index": "src/vite/index.ts",
      "internal/vite-handler": "src/vite/handler-unavailable.ts",
    },
    // ESM-only: the v2 @modelcontextprotocol/* packages ship no CJS entry, so a
    // CJS build of this package could never load them.
    format: ["esm"],
    target: "node22",
    dts: false,
    splitting: true,
    sourcemap: false,
    clean: true,
    external: [
      "@mcp-use/client",
      "@mcp-use/cli",
      "#mcp-use-node-http",
      "#mcp-use-skills-loader",
      "#mcp-use-vite-handler",
    ],
    define: packageVersionDefine,
    esbuildPlugins: sharedBufferedResponse,
    esbuildOptions: minifyFrameworkOutput,
  },
  // Compact only the edge root graph. The CLI and integration entries above
  // retain readable identifiers, and public function/class names stay intact.
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node22",
    dts: false,
    splitting: true,
    sourcemap: false,
    clean: false,
    external: [
      "@mcp-use/client",
      "@mcp-use/cli",
      "#mcp-use-node-http",
      "#mcp-use-skills-loader",
      "#mcp-use-vite-handler",
    ],
    define: packageVersionDefine,
    esbuildPlugins: sharedBufferedResponse,
    esbuildOptions(options) {
      minifyFrameworkOutput(options);
      options.minifyIdentifiers = true;
      options.keepNames = true;
    },
  },
  // Node inlines Hono and the v2 SDK to reduce module-linking overhead on
  // cold process starts, while sharing the private response identity module. The
  // generic root above stays split and free of Node builtins for Workers.
  {
    entry: {
      "index-node": "src/index.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    external: ["@mcp-use/client", "@mcp-use/cli", "#mcp-use-skills-loader"],
    noExternal: [
      "hono",
      "@modelcontextprotocol/core",
      "@modelcontextprotocol/server",
      "zod",
    ],
    define: packageVersionDefine,
    esbuildPlugins: sharedBufferedResponse,
    esbuildOptions(options) {
      minifyFrameworkOutput(options);
      options.alias = {
        ...options.alias,
        "#mcp-use-node-http": "node:http",
      };
    },
  },
  // Browser-only view runtime (`mcp-use/react`). Must not be reachable
  // from the `.` export or `bin` graphs — same invariant as the cli chunk above.
  {
    entry: {
      "react/index": "src/react/index.ts",
    },
    format: ["esm"],
    target: "es2022",
    platform: "browser",
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    define: packageVersionDefine,
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@modelcontextprotocol/ext-apps",
    ],
  },
]);
