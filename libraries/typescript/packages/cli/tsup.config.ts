import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const cliPackage = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  // Dist entry names stay stable (`commands/*`) so the published layout and
  // the server package's CLI budget test do not depend on the source layout.
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
    "internal/skills-loader": "src/skills/node-loader.ts",
    "internal/vite": "src/internal/vite.ts",
    "next-server-shims": "src/toolchain/next-server-shims.ts",
    "commands/start": "src/toolchain/commands/start.ts",
    "commands/dev": "src/toolchain/commands/dev.ts",
    "commands/build": "src/toolchain/commands/build.ts",
    "commands/typecheck": "src/toolchain/commands/typecheck.ts",
    "commands/login": "src/cloud/auth/login.ts",
    "commands/logout": "src/cloud/auth/logout.ts",
    "commands/whoami": "src/cloud/auth/whoami.ts",
    "commands/organizations": "src/cloud/organizations.ts",
    "commands/servers": "src/cloud/servers.ts",
    "commands/deployments": "src/cloud/deployments.ts",
    "commands/deploy": "src/cloud/deploy/index.ts",
    "commands/link": "src/cloud/project/link.ts",
    "commands/unlink": "src/cloud/project/unlink.ts",
    "commands/client": "src/client/client.ts",
    "commands/screenshot": "src/client/screenshot.ts",
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
    "@tailwindcss/vite",
    "@vitejs/plugin-react",
    "tailwindcss",
    "vite",
  ],
  // Ship tunnel support inside the CLI artifact without adding a runtime
  // dependency to either @mcp-use/cli or mcp-use.
  noExternal: [
    "@mcp-use/tunnel",
    "openapi-fetch",
    "@modelcontextprotocol/client",
  ],
  define: {
    __MCP_USE_CLI_VERSION__: JSON.stringify(cliPackage.version),
  },
});
