import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser-agent.ts"],
  format: ["esm", "cjs"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
});
