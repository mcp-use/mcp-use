import { defineConfig } from "tsup";

const bundledServerDependencies = [
  "hono",
  "@hono/node-server",
  "open",
  "rate-limiter-flexible",
];

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
  },
]);
