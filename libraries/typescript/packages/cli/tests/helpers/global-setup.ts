import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typescriptRoot = path.resolve(__dirname, "../../..");
const mcpUsePackageDir = path.join(typescriptRoot, "packages", "mcp-use");

const requiredMcpUseOutputs = [
  "dist/index.js",
  "dist/src/client.js",
  "dist/src/project-config.js",
  "dist/src/server/index.js",
].map((relativePath) => path.join(mcpUsePackageDir, relativePath));

export default function globalSetup() {
  if (requiredMcpUseOutputs.every((outputPath) => existsSync(outputPath))) {
    return;
  }

  execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", "mcp-use", "build"],
    {
      cwd: typescriptRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        MCP_USE_ANONYMIZED_TELEMETRY: "false",
      },
    }
  );
}
