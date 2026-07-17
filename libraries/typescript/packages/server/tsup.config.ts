import { defineConfig } from "tsup";

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
      // The `mcp-use` bin (package.json "bin"). Its source shebang is
      // preserved by esbuild, so dist/bin.js stays directly executable.
      bin: "src/bin.ts",
      "node-bridge": "src/node-bridge.ts",
      // Each substantial command is a real sibling entry reached only through
      // the bin's dynamic imports. `start` therefore cannot evaluate Vite,
      // while `dev` and `build` remain isolated from each other.
      "commands/start": "src/commands/start.ts",
      "commands/dev": "src/commands/dev.ts",
      "commands/build": "src/commands/build.ts",
      "commands/identity": "src/commands/identity.ts",
      "commands/organizations": "src/commands/organizations.ts",
      "commands/servers": "src/commands/servers.ts",
      "commands/deployments": "src/commands/deployments.ts",
      "commands/deploy": "src/commands/deploy.ts",
      "commands/client": "src/commands/client.ts",
      "commands/skills": "src/commands/skills.ts",
      "commands/screenshot": "src/commands/screenshot.ts",
    },
    // ESM-only: the v2 @modelcontextprotocol/* packages ship no CJS entry, so a
    // CJS build of this package could never load them.
    format: ["esm"],
    target: "node24",
    dts: false,
    // Splitting on is load-bearing, not a size optimization: without it esbuild
    // inlines the dynamically-`import()`-ed cli module graph directly into
    // dist/bin.js as a lazily-*initialized* — but still statically imported —
    // module, hoisting `import "vite"` to the top of dist/bin.js and violating
    // the invariant that `start` never evaluates a module that imports vite.
    // With splitting on, command entries remain genuinely separate files
    // reached by real runtime dynamic imports.
    splitting: true,
    sourcemap: true,
    clean: true,
    external: ["@mcp-use/client"],
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
    sourcemap: true,
    clean: false,
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@modelcontextprotocol/ext-apps",
    ],
  },
]);
