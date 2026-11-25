import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const bundledServerDependencies = [
  "hono",
  "@hono/node-server",
  "@mcp-use/client",
  "@mcp-use/events-core",
  "open",
  "rate-limiter-flexible",
];
const rateLimiterMemoryShim = fileURLToPath(
  new URL("./src/server/rate-limiter-flexible.ts", import.meta.url)
);
const rateLimiterMemoryAdapter = fileURLToPath(
  import.meta.resolve("rate-limiter-flexible/lib/RateLimiterMemory.js")
);

function bundleOnlyMemoryRateLimiter(options: {
  alias?: Record<string, string>;
}) {
  options.alias = {
    ...options.alias,
    "rate-limiter-flexible": rateLimiterMemoryShim,
    "inspector-rate-limiter-memory": rateLimiterMemoryAdapter,
  };
}

// The MCP SDK the Inspector bundle compiles in (through @mcp-use/client),
// reported by `GET /inspector/api/version` (76 I1).
function bundledSdkVersion(): string | null {
  try {
    const require = createRequire(
      new URL("../client/package.json", import.meta.url)
    );
    let dir = dirname(require.resolve("@modelcontextprotocol/client"));
    for (;;) {
      try {
        const manifest = JSON.parse(
          readFileSync(join(dir, "package.json"), "utf8")
        );
        if (manifest.name === "@modelcontextprotocol/client") {
          return manifest.version;
        }
      } catch {
        // keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}
const sdkDefine = {
  __MCP_USE_BUNDLED_SDK_VERSION__: JSON.stringify(bundledSdkVersion()),
};

export default defineConfig([
  {
    entry: { "server/index": "src/server/index.ts" },
    format: ["esm"],
    target: "node22",
    platform: "node",
    tsconfig: "tsconfig.server.json",
    splitting: false,
    sourcemap: false,
    minify: true,
    dts: true,
    noExternal: bundledServerDependencies,
    esbuildOptions: bundleOnlyMemoryRateLimiter,
    define: sdkDefine,
  },
  {
    entry: { cli: "src/server/cli.ts" },
    format: ["esm"],
    target: "node22",
    platform: "node",
    tsconfig: "tsconfig.server.json",
    splitting: false,
    sourcemap: false,
    minify: true,
    dts: false,
    clean: false,
    noExternal: bundledServerDependencies,
    esbuildOptions: bundleOnlyMemoryRateLimiter,
    define: sdkDefine,
  },
]);
