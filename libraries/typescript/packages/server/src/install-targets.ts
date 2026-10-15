/**
 * Install links and commands that add an MCP server to common clients.
 *
 * The built-in landing page, `useInstallTargets()` and pages outside the
 * server, such as a docs site, all build them here so they cannot drift.
 * This module uses only web-standard globals and does not import React.
 */

/** Claude Code install target: a terminal command. */
export interface ClaudeCodeInstallTarget {
  /** Client name, suitable as a tab or button label. */
  label: "Claude Code";

  /**
   * `claude mcp add` command for a POSIX shell, with the server URL
   * single-quoted so shell metacharacters in it are not expanded.
   */
  command: string;
}

/** Cursor install target: a deep link that opens Cursor's install prompt. */
export interface CursorInstallTarget {
  /** Client name, suitable as a tab or button label. */
  label: "Cursor";

  /** `cursor://` link carrying the server URL as base64-encoded JSON. */
  deeplink: string;
}

/** VS Code install target: a deep link that opens VS Code's install prompt. */
export interface VSCodeInstallTarget {
  /** Client name, suitable as a tab or button label. */
  label: "VS Code";

  /** `vscode:` link carrying the server name, URL and HTTP transport. */
  deeplink: string;
}

/** VS Code Insiders install target: a deep link to the Insiders build. */
export interface VSCodeInsidersInstallTarget {
  /** Client name, suitable as a tab or button label. */
  label: "VS Code Insiders";

  /** `vscode-insiders:` link carrying the server name, URL and transport. */
  deeplink: string;
}

/** ChatGPT install target: manual steps, since ChatGPT has no deep link. */
export interface ChatGPTInstallTarget {
  /** Client name, suitable as a tab or button label. */
  label: "ChatGPT";

  /**
   * Plain-text steps in order, each a short heading, `": "`, and the
   * instruction. The import step includes the server URL.
   */
  steps: readonly string[];
}

/** Manufact Inspector target: the hosted inspector, connected to the server. */
export interface InspectorInstallTarget {
  /** Tool name, suitable as a tab or button label. */
  label: "Manufact Inspector";

  /** Hosted inspector URL that connects to the server and opens its chat. */
  url: string;
}

/** The server {@link getInstallTargets} builds install targets for. */
export interface InstallTargetServer {
  /** Absolute URL of the MCP endpoint. */
  url: string;

  /**
   * Server name. Clients store it lowercased, with characters other than
   * letters, digits, `-` and `_` replaced by `_`. The built-in landing page
   * and `useInstallTargets()` pass the server's `title ?? name`.
   */
  name: string;
}

/**
 * Install targets for one MCP server, keyed by client.
 *
 * Keys are in display order, so `Object.values()` gives Claude Code, Cursor,
 * VS Code, VS Code Insiders, ChatGPT, then Manufact Inspector.
 */
export interface InstallTargets {
  /** Claude Code terminal command. */
  claudeCode: ClaudeCodeInstallTarget;

  /** Cursor deep link. */
  cursor: CursorInstallTarget;

  /** VS Code deep link. */
  vscode: VSCodeInstallTarget;

  /** VS Code Insiders deep link. */
  vscodeInsiders: VSCodeInsidersInstallTarget;

  /** ChatGPT connector steps. */
  chatgpt: ChatGPTInstallTarget;

  /** Hosted Manufact Inspector link. */
  inspector: InspectorInstallTarget;
}

/**
 * Sanitizes a server name for use in filenames and URLs.
 * Replaces non-alphanumeric characters with underscores and converts to lowercase.
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
}

/**
 * Base64-encodes the UTF-8 bytes of `text`. `btoa` alone accepts only
 * Latin-1, so a URL with other characters would throw in a browser.
 */
function utf8ToBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Generates a Cursor deep link for installing an MCP server.
 * The config is base64-encoded JSON containing the server URL.
 */
function generateCursorDeepLink(url: string, name: string): string {
  const base64Config = utf8ToBase64(JSON.stringify({ url }));
  const sanitizedName = sanitizeServerName(name);
  return `cursor://anysphere.cursor-deeplink/mcp/install?config=${encodeURIComponent(base64Config)}&name=${encodeURIComponent(sanitizedName)}`;
}

/**
 * Generates a VS Code deep link for installing an MCP server.
 * The config is URL-encoded JSON containing the server URL.
 */
function generateVSCodeDeepLink(url: string, name: string): string {
  const config = {
    url,
    name: sanitizeServerName(name),
    type: "http",
  };
  const configJson = JSON.stringify(config);
  const urlEncodedConfig = encodeURIComponent(configJson);
  return `vscode:mcp/install?${urlEncodedConfig}`;
}

/**
 * Generates a VS Code Insiders deep link for installing an MCP server.
 * The config is URL-encoded JSON containing the server URL.
 */
function generateVSCodeInsidersDeepLink(url: string, name: string): string {
  const config = {
    url,
    name: sanitizeServerName(name),
    type: "http",
  };
  const configJson = JSON.stringify(config);
  const urlEncodedConfig = encodeURIComponent(configJson);
  return `vscode-insiders:mcp/install?${urlEncodedConfig}`;
}

/**
 * Generates a Claude Code CLI command for adding an MCP server.
 */
function generateClaudeCommand(url: string, name: string): string {
  const sanitizedName = sanitizeServerName(name);
  const quotedUrl = `'${url.replace(/'/g, "'\\''")}'`;
  return `claude mcp add --transport http "${sanitizedName}" ${quotedUrl}`;
}

/** Hosted Manufact Inspector base (same as cloud deploy “Open in new tab”). */
const MANUFACT_INSPECTOR_ORIGIN = "https://inspector.manufact.com";

/**
 * Deep link to hosted Manufact Inspector with this MCP server URL pre-filled
 * and the Chat tab selected (`tab=chat`).
 */
function getManufactInspectorUrl(serverUrl: string): string {
  const params = new URLSearchParams({
    autoConnect: serverUrl,
    tab: "chat",
  });
  return `${MANUFACT_INSPECTOR_ORIGIN}/inspector?${params.toString()}`;
}

/** Steps to add the server as a ChatGPT connector in developer mode. */
function getChatGPTSteps(url: string): readonly string[] {
  return [
    "Enable Developer Mode: Settings → Connectors → Advanced → Developer mode",
    `Import this MCP server: Go to Connectors tab and add: ${url}`,
    "Use in conversations: Choose the MCP server from the Plus menu",
  ];
}

/**
 * Build the links and commands that add an MCP server to Claude Code,
 * Cursor, VS Code, VS Code Insiders, ChatGPT and Manufact Inspector.
 *
 * Runs in Node, edge runtimes and browsers. Values are not HTML-escaped:
 * JSX escapes them, but HTML built as a string must.
 *
 * @param server - Endpoint URL and name of the server to install.
 * @returns One install target per client, in display order.
 *
 * @example
 * ```ts
 * import { getInstallTargets } from "mcp-use/landing";
 *
 * const install = getInstallTargets({
 *   url: "https://acme.com/mcp",
 *   name: "acme",
 * });
 * install.claudeCode.command;
 * // claude mcp add --transport http "acme" 'https://acme.com/mcp'
 * ```
 */
export function getInstallTargets(server: InstallTargetServer): InstallTargets {
  const { url, name } = server;
  return {
    claudeCode: {
      label: "Claude Code",
      command: generateClaudeCommand(url, name),
    },
    cursor: { label: "Cursor", deeplink: generateCursorDeepLink(url, name) },
    vscode: { label: "VS Code", deeplink: generateVSCodeDeepLink(url, name) },
    vscodeInsiders: {
      label: "VS Code Insiders",
      deeplink: generateVSCodeInsidersDeepLink(url, name),
    },
    chatgpt: { label: "ChatGPT", steps: getChatGPTSteps(url) },
    inspector: {
      label: "Manufact Inspector",
      url: getManufactInspectorUrl(url),
    },
  };
}
