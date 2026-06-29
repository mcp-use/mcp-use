import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/llm/toolLoop.ts", "src/llm/types.ts"],
  format: ["esm"],
  outDir: "dist/llm",
  splitting: false,
  sourcemap: true,
  clean: false,
});
