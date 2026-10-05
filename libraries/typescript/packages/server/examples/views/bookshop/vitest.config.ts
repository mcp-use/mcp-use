import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "happy-dom", include: ["tests/view.test.tsx"] },
});
