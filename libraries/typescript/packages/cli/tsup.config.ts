import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const cliPackage = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
    "next-server-shims": "src/cli/next-server-shims.ts",
    "commands/start": "src/commands/start.ts",
    "commands/dev": "src/commands/dev.ts",
    "commands/build": "src/commands/build.ts",
    "commands/typecheck": "src/commands/typecheck.ts",
    "commands/identity": "src/commands/identity.ts",
    "commands/organizations": "src/commands/organizations.ts",
    "commands/servers": "src/commands/servers.ts",
    "commands/deployments": "src/commands/deployments.ts",
    "commands/deploy": "src/commands/deploy.ts",
    "commands/client": "src/commands/client.ts",
    "commands/screenshot": "src/commands/screenshot.ts",
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
