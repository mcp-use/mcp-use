import { defineConfig } from "tsup";

// Runtime-neutral ESM (Node, Bun, Deno, workerd, browsers): WebCrypto only, no
// Node built-ins, no dependencies. `mcp-use` bundles this package through
// `noExternal`, so every module stays side-effect free for tree shaking.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "conformance/index": "src/conformance/index.ts",
  },
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  splitting: true,
  treeshake: true,
  sourcemap: false,
  clean: true,
  dts: false,
});
