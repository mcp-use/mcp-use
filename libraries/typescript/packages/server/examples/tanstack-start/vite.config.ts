import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { mcpUseTanStackStart } from "mcp-use/tanstack-start/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    mcpUseTanStackStart({
      entry: "./src/mcp/server.ts",
      viewsDir: "./src/mcp/views",
      basePath: "/api/mcp",
    }),
    tanstackStart(),
    nitro({ preset: "node-server" }),
    react(),
  ],
});
