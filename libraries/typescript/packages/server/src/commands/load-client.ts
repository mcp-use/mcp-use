import { UsageError } from "./shared.js";

/** Runtime surface loaded from the independently published client SDK. */
export type ClientPackage = typeof import("@mcp-use/client");

const INSTALL_HINT = [
  "[mcp-use] @mcp-use/client is not installed.",
  "The `mcp-use client` and `mcp-use screenshot` commands require it.",
  "Install it in your project:",
  "",
  "  npm install @mcp-use/client",
  "",
  "  pnpm add @mcp-use/client",
  "",
  "  bun add @mcp-use/client",
].join("\n");

/**
 * Load `@mcp-use/client` on demand so the framework library entry does not
 * pull the client SDK (or legacy v1 transitive deps) into every install.
 *
 * @throws {@link UsageError} When the package is not installed, with install
 * instructions for npm, pnpm, and bun.
 */
export async function loadClientPackage(): Promise<ClientPackage> {
  try {
    return await import("@mcp-use/client");
  } catch (error) {
    if (isClientPackageMissing(error)) {
      throw new UsageError(INSTALL_HINT);
    }
    throw error;
  }
}

function isClientPackageMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return (
      error.message.includes("@mcp-use/client") ||
      error.message.includes("Cannot find package")
    );
  }
  return false;
}
