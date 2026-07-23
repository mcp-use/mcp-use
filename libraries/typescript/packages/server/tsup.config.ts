import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const frameworkPackage = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      // OAuth subpath exports mirror tsc's rootDir:src layout so generated JS
      // and declarations stay aligned with package.json's exports map.
      "oauth/index": "src/oauth/index.ts",
      "oauth/clerk": "src/oauth/clerk.ts",
      "oauth/auth0": "src/oauth/auth0.ts",
      "oauth/workos": "src/oauth/workos.ts",
      "oauth/supabase": "src/oauth/supabase.ts",
      "oauth/keycloak": "src/oauth/keycloak.ts",
      "oauth/better-auth": "src/oauth/better-auth.ts",
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
      // Runtime-only binary: owns `mcp-use start` and delegates development
      // commands to the separately installed @mcp-use/cli package.
      bin: "src/bin.ts",
      "node-bridge": "src/node-bridge.ts",
      "next/index": "src/next/index.ts",
    },
    // ESM-only: the v2 @modelcontextprotocol/* packages ship no CJS entry, so a
    // CJS build of this package could never load them.
    format: ["esm"],
    target: "node22",
    dts: false,
    splitting: true,
    sourcemap: false,
    clean: true,
    external: ["@mcp-use/client", "@mcp-use/cli"],
    define: {
      __MCP_USE_PACKAGE_VERSION__: JSON.stringify(frameworkPackage.version),
    },
    esbuildOptions(options) {
      options.minifySyntax = true;
      options.minifyWhitespace = true;
      options.minifyIdentifiers = false;
    },
  },
  // Deprecated temporary v1 compatibility entry. Build it independently so
  // shared-chunk extraction cannot alter the native root entry's graph or
  // edge/startup budgets. Remove this whole target in mcp-use v3.
  {
    entry: {
      "compat-v1": "src/compat-v1.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    external: ["@mcp-use/client", "@mcp-use/cli"],
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
    define: {
      __MCP_USE_PACKAGE_VERSION__: JSON.stringify(frameworkPackage.version),
    },
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@modelcontextprotocol/ext-apps",
    ],
  },
]);
