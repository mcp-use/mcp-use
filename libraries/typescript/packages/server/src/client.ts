/**
 * Back-compat re-export of {@link MCPClient} from the optional
 * `@mcp-use/client` peer.
 *
 * At v2 cutover this package becomes `mcp-use`. Existing
 * `import { MCPClient } from "mcp-use"` call sites keep working when the peer
 * is installed; otherwise the first use throws with an install hint.
 */

const PACKAGE = "@mcp-use/client";

type ClientModule = typeof import("@mcp-use/client");
type MCPClientCtor = ClientModule["MCPClient"];

/**
 * Error thrown when `@mcp-use/client` is not installed.
 *
 * @param cause - Underlying resolve/import failure, when available.
 * @returns Error naming the missing package and the install command.
 */
function missingClientError(cause?: unknown): Error {
  const err = new Error(
    `${PACKAGE} is not installed. MCPClient lives in a separate package.\n` +
      `Install it with: npm install ${PACKAGE}`
  );
  if (cause instanceof Error) {
    err.cause = cause;
  }
  return err;
}

/**
 * Whether `error` looks like a missing/unresolvable package.
 *
 * @param error - Caught import/resolve failure.
 * @returns `true` when the failure should surface as an install hint.
 */
function isModuleNotFound(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return (
    err?.code === "MODULE_NOT_FOUND" ||
    err?.code === "ERR_MODULE_NOT_FOUND" ||
    err?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
    !!err?.message?.includes(PACKAGE) ||
    !!err?.message?.includes("Cannot find package") ||
    !!err?.message?.includes("Cannot find module")
  );
}

/**
 * Stub constructor that always throws the install hint.
 *
 * @returns Proxy shaped like {@link MCPClient} that fails on use.
 */
function throwingMCPClient(): MCPClientCtor {
  return new Proxy(function MCPClient() {} as unknown as MCPClientCtor, {
    construct() {
      throw missingClientError();
    },
    get(_target, prop) {
      if (prop === "name") return "MCPClient";
      if (prop === "prototype") return {};
      throw missingClientError();
    },
  });
}

/**
 * Dynamically import `@mcp-use/client`, or throw an install hint if missing.
 *
 * @returns The loaded `@mcp-use/client` module.
 * @throws When the package is not installed as a dependency.
 *
 * @example
 * ```ts
 * const { MCPClient } = await importMcpClient();
 * const client = new MCPClient({ mcpServers: { demo: { url: "…" } } });
 * ```
 */
export async function importMcpClient(): Promise<ClientModule> {
  try {
    return await import("@mcp-use/client");
  } catch (error) {
    if (isModuleNotFound(error)) throw missingClientError(error);
    throw error;
  }
}

/**
 * `MCPClient` from `@mcp-use/client`, loaded via dynamic import.
 *
 * Missing peer → stub that throws an install hint on first use, so
 * server-only installs of this package still load.
 */
let MCPClient: MCPClientCtor;
try {
  MCPClient = (await importMcpClient()).MCPClient;
} catch (error) {
  if (error instanceof Error && error.message.includes("is not installed")) {
    MCPClient = throwingMCPClient();
  } else {
    throw error;
  }
}

export { MCPClient };
/**
 * Instance type of the re-exported {@link MCPClient} constructor.
 */
export type MCPClient = InstanceType<MCPClientCtor>;
