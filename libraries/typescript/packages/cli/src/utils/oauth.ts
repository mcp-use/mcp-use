import {
  auth,
  NodeOAuthClientProvider,
  OAuthFlowError,
  UnauthorizedError,
  type NodeOAuthOptions,
} from "mcp-use/auth/node";
import { createInterface } from "node:readline";

/**
 * Build a NodeOAuthClientProvider that prints the authorization URL for the
 * user to open themselves. We never auto-launch a browser from the CLI — a
 * surprise window when an agent or script invokes `mcp-use` is worse than the
 * extra click for an interactive user.
 */
export async function buildOAuthProvider(
  serverUrl: string,
  options: Omit<NodeOAuthOptions, "openBrowser"> = {}
): Promise<NodeOAuthClientProvider> {
  return NodeOAuthClientProvider.create(serverUrl, {
    clientName: "mcp-use CLI",
    clientUri: "https://mcp-use.com",
    storageKeyPrefix: "mcp:auth",
    ...options,
    openBrowser: async (url) => {
      console.error(`\n  Open this URL in a browser to authenticate:`);
      console.error(`  ${url}\n`);
    },
  });
}

/**
 * Run the full two-call OAuth dance:
 *   1. auth() → triggers redirectToAuthorization (prints URL, binds loopback)
 *   2. await provider.getAuthorizationCode()
 *   3. auth() with the code → exchanges for tokens, persists via FileKVStore
 *
 * Mirrors the orchestrator pattern in `useMcp.ts:1121-1145`.
 */
export async function runOAuthFlow(
  provider: NodeOAuthClientProvider,
  serverUrl: string,
  print: (line: string) => void = console.error.bind(console)
): Promise<void> {
  print(`→ OAuth authentication required.`);
  print(
    `  Listening on http://127.0.0.1:${provider.callbackPort}/callback (waiting up to 5m)`
  );

  // SDK transports (e.g. StreamableHTTPClientTransport) auto-call auth() on a
  // 401, which already invokes redirectToAuthorization (loopback bound, browser
  // opened). In that case skip the first auth() call — calling it again would
  // throw "an authorization is already in progress".
  if (!provider.hasPendingFlow) {
    const result = await auth(provider, { serverUrl });
    if (result === "AUTHORIZED") {
      // Pre-existing valid tokens; nothing to do.
      return;
    }
    if (result !== "REDIRECT") {
      throw new OAuthFlowError(
        "unexpected_auth_result",
        `auth() returned ${result}`
      );
    }
  }

  const code = await provider.getAuthorizationCode();
  await auth(provider, { serverUrl, authorizationCode: code });
}

/** True if the unwrapped error is an SDK 401 we should respond to with OAuth. */
export function isUnauthorized(err: unknown): boolean {
  if (err instanceof UnauthorizedError) return true;
  // Some transports rewrap; check by name + message as a fallback.
  if (err instanceof Error && err.name === "UnauthorizedError") return true;
  // mcp-use's HttpConnector rewraps SDK 401s as a plain Error with `code = 401`
  // (see packages/mcp-use/src/connectors/http.ts:228, :255).
  if (err instanceof Error && (err as { code?: unknown }).code === 401) {
    return true;
  }
  return false;
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
