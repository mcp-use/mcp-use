import { defineConfig } from "tsup";

export default defineConfig({
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
    // The `mcp-use` bin (package.json "bin"). Its source shebang is
    // preserved by esbuild, so dist/bin.js stays directly executable.
    bin: "src/bin.ts",
    // The dev/build toolchain (Vite), emitted as its own dist/cli/index.js
    // and reached only via `bin/main.ts`'s dynamic `import("./cli/index.js")`
    // — nothing in `index`/`bin`'s static import graph reaches src/cli/*,
    // so `start` and the library export path never evaluate a module that
    // imports vite (CLI_SPEC.md § Package layout & dependency rules).
    "cli/index": "src/cli/index.ts",
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
  // With splitting on, the cli entry becomes a genuinely separate
  // dist/cli/index.js chunk reached by a real runtime dynamic import.
  splitting: true,
  sourcemap: true,
  clean: true,
});
