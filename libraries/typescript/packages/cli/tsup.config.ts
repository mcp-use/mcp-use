import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";
import {
  POSTHOG_API_KEY,
  POSTHOG_HOST,
} from "../client/src/telemetry/tel-fetch.js";

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
    "commands/organizations": "src/cloud/org/index.ts",
    "commands/servers": "src/cloud/servers/index.ts",
    "commands/deployments": "src/cloud/deployments/index.ts",
    "commands/deploy": "src/cloud/deploy/index.ts",
    "commands/env": "src/cloud/environment/index.ts",
    "commands/logs": "src/cloud/logs/index.ts",
    "commands/link": "src/cloud/project/link.ts",
    "commands/unlink": "src/cloud/project/unlink.ts",
    "commands/domains": "src/cloud/domains/index.ts",
    "commands/github": "src/cloud/github/index.ts",
    "commands/checklist": "src/cloud/checklist/index.ts",
    "commands/alerts": "src/cloud/alerts/index.ts",
    "commands/skills": "src/skills/install.ts",
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
  noExternal: ["@mcp-use/tunnel", "openapi-fetch"],
  define: {
    __MCP_USE_CLI_VERSION__: JSON.stringify(cliPackage.version),
    // Reuse the SDK's public ingestion project at build time. The CLI stays
    // independent of the optional client package at runtime.
    __MCP_USE_POSTHOG_HOST__: JSON.stringify(
      process.env.MCP_USE_POSTHOG_HOST ?? POSTHOG_HOST
    ),
    __MCP_USE_POSTHOG_KEY__: JSON.stringify(
      process.env.MCP_USE_POSTHOG_API_KEY ?? POSTHOG_API_KEY
    ),
  },
});
