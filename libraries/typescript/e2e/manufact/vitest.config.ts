import { defineConfig } from "vitest/config";

// Unit tests of the harness itself: no network, no Cloud.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
