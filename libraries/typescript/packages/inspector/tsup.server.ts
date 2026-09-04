import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const bundledServerDependencies = [
  "hono",
  "@hono/node-server",
  "@mcp-use/client",
  "open",
  "redis",
  "rate-limiter-flexible",
];
const rateLimiterMemoryShim = fileURLToPath(
  new URL("./src/server/rate-limiter-flexible.ts", import.meta.url)
);
const rateLimiterMemoryAdapter = fileURLToPath(
  import.meta.resolve("rate-limiter-flexible/lib/RateLimiterMemory.js")
);
// Redis is bundled to keep the standalone Inspector self-contained. Its
// CommonJS transitive dependencies use require("node:crypto") and friends;
// provide the native ESM-safe require that those modules expect.
const nodeRequireBanner = {
  js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
};

function bundleOnlyMemoryRateLimiter(options: {
  alias?: Record<string, string>;
}) {
  options.alias = {
    ...options.alias,
    "rate-limiter-flexible": rateLimiterMemoryShim,
    "inspector-rate-limiter-memory": rateLimiterMemoryAdapter,
  };
}

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
    banner: nodeRequireBanner,
    esbuildOptions: bundleOnlyMemoryRateLimiter,
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
    banner: nodeRequireBanner,
    esbuildOptions: bundleOnlyMemoryRateLimiter,
  },
]);
