import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
