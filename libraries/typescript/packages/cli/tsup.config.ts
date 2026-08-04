import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const cliPackage = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
    "next-server-shims": "../server/src/cli/next-server-shims.ts",
    "commands/start": "../server/src/commands/start.ts",
    "commands/dev": "../server/src/commands/dev.ts",
    "commands/build": "../server/src/commands/build.ts",
    "commands/typecheck": "../server/src/commands/typecheck.ts",
    "commands/identity": "../server/src/commands/identity.ts",
    "commands/organizations": "../server/src/commands/organizations.ts",
    "commands/servers": "../server/src/commands/servers.ts",
    "commands/deployments": "../server/src/commands/deployments.ts",
    "commands/deploy": "../server/src/commands/deploy.ts",
    "commands/client": "../server/src/commands/client.ts",
    "commands/screenshot": "../server/src/commands/screenshot.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  splitting: true,
  sourcemap: false,
  minify: true,
  dts: false,
  // The build pipeline is installed with the CLI, not with generated apps.
  // Preserve its package-relative runtime lookups rather than rebundling it.
  // Tunnel is intentionally bundled into lazy command chunks so mcp-use does
  // not install a second runtime package for its built-in tunnel support.
  external: [
    "@mcp-use/client",
    "@mcp-use/inspector",
    "@modelcontextprotocol/server",
    "@tailwindcss/vite",
    "@vitejs/plugin-react",
    "tailwindcss",
    "vite",
  ],
  define: {
    __MCP_USE_CLI_VERSION__: JSON.stringify(cliPackage.version),
  },
});
