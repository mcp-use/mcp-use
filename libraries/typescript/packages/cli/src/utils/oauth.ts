import {
  NodeOAuthClientProvider,
  completeOAuthFlow,
  isUnauthorized,
  type NodeOAuthOptions,
} from "@mcp-use/client";
import { createInterface } from "node:readline";

export { completeOAuthFlow, isUnauthorized };

/** Print-only opener — CLI never auto-launches a browser. */
export async function printAuthUrl(url: string): Promise<void> {
  console.error(`\n  Open this URL in a browser to authenticate:`);
  console.error(`  ${url}\n`);
}

/** Default `oauth` bag for MCPClient auto-provisioning from the CLI. */
export function cliOAuthOptions(
  options: Omit<NodeOAuthOptions, "openBrowser"> = {}
): NodeOAuthOptions {
  return {
    clientName: "mcp-use CLI",
    clientUri: "https://mcp-use.com",
    storageKeyPrefix: "mcp:auth",
    ...options,
    openBrowser: printAuthUrl,
  };
}

/**
 * Build a NodeOAuthClientProvider for CLI auth subcommands that need the
 * provider handle directly (logout / token clear). Connect paths should use
 * `cliOAuthOptions` on server config instead.
 */
export async function buildOAuthProvider(
  serverUrl: string,
  options: Omit<NodeOAuthOptions, "openBrowser"> = {}
): Promise<NodeOAuthClientProvider> {
  return NodeOAuthClientProvider.create(serverUrl, cliOAuthOptions(options));
}

/** Minimal yes/no prompt. Returns true on Y/y/yes/<enter>, false otherwise. */
export async function promptYesNo(
  question: string,
  defaultYes = true
): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question} ${defaultYes ? "[Y/n] " : "[y/N] "}`, resolve);
    });
    const trimmed = answer.trim().toLowerCase();
    if (!trimmed) return defaultYes;
    return trimmed === "y" || trimmed === "yes";
  } finally {
    rl.close();
  }
}
