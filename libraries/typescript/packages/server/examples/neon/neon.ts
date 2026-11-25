import { defineConfig } from "@neon/config/v1";

/** Neon Functions deployment policy from the with-mcp template. */
export default defineConfig({
  functions: {
    events: {
      name: "events mcp server",
      source: "src/index.ts",
    },
  },
});
