import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const bundledServerDependencies = [
  "hono",
  "@hono/node-server",
  "@mcp-use/client",
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
  },
]);
