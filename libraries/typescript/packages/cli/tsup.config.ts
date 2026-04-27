import { cp } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: ["chalk", "open", "globby"],
  shims: true,
  // Copy the Next.js runtime shim loader/register scripts into dist/shims/.
  // These must stay as standalone .mjs files so Node can load them via
  // `module.register()` / `--import=...`. See src/utils/next-shims.ts.
  async onSuccess() {
    await cp("src/shims", "dist/shims", {
      recursive: true,
      filter: (src) => !src.endsWith(".DS_Store"),
    });
  },
});
