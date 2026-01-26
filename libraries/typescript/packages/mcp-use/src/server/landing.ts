/**
 * Landing page generator for MCP server endpoints
 *
 * Generates plain text instructions for connecting to MCP servers
 * from Claude Code, Cursor, and ChatGPT clients.
 */

/**
 * Sanitizes a server name for use in filenames and URLs.
 * Replaces non-alphanumeric characters with underscores and converts to lowercase.
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
}

/**
 * Generates a Cursor deep link for installing an MCP server.
 * The config is base64-encoded JSON containing the server URL.
 */
function generateCursorDeepLink(url: string, name: string): string {
  const config = { url };
  const configJson = JSON.stringify(config);

  // Use Buffer in Node.js or btoa in browser-like environments
  const base64Config =
    typeof Buffer !== "undefined"
      ? Buffer.from(configJson).toString("base64")
      : btoa(configJson);

  const sanitizedName = sanitizeServerName(name);
  return `cursor://anysphere.cursor-deeplink/mcp/install?config=${base64Config}&name=${encodeURIComponent(sanitizedName)}`;
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
  return `claude mcp add --transport http "${sanitizedName}" ${url}`;
}

/**
 * Generates an HTML landing page with connection instructions
 * for Claude Code, Cursor, and ChatGPT.
 *
 * @param name - Server name
 * @param version - Server version
 * @param url - Full server URL (including protocol, host, port, and path)
 * @param description - Optional server description
 * @param tools - Optional list of tool names
 * @returns HTML landing page with connection instructions
 */
export function generateLandingPage(
  name: string,
  version: string,
  url: string,
  description?: string,
  tools?: string[]
): string {
  const cursorDeepLink = generateCursorDeepLink(url, name);
  const vscodeDeepLink = generateVSCodeDeepLink(url, name);
  const vscodeInsidersDeepLink = generateVSCodeInsidersDeepLink(url, name);
  const claudeCommand = generateClaudeCommand(url, name);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${name}</title>
<style>
* {
  font-family: monospace;
  font-size: 14px;
  font-weight: normal;
  color: #333;
  line-height: 1.5;
}
body {
  margin: 20px;
}
h1 {
  font-size: 18px;
  font-weight: bold;
  margin: 20px 0 10px 0;
}
h2 {
  font-size: 14px;
  font-weight: normal;
  margin: 20px 0 10px 0;
}
p, pre, ol, li, ul {
  margin: 5px 0;
}
a {
  color: #333;
  text-decoration: underline;
}
pre {
  margin: 10px 0;
  white-space: pre-wrap;
}
ol, ul {
  padding-left: 20px;
}
.description {
  margin: 10px 0;
  color: #666;
}
.tools {
  margin: 15px 0;
}
</style>
</head>
<body>
<h1>${name} (v${version})</h1>

${description ? `<p class="description">${description}</p>` : ""}

${
  tools && tools.length > 0
    ? `<div class="tools">
<strong>Available Tools:</strong>
<ul>
${tools.map((tool) => `<li>${tool}</li>`).join("\n")}
</ul>
</div>`
    : ""
}

<p>URL: ${url}</p>

<h2>Connect with Claude Code</h2>
<pre>${claudeCommand}</pre>

<h2>Connect with Cursor</h2>
<p><a href="${cursorDeepLink}">${cursorDeepLink}</a></p>

<h2>Connect with VS Code</h2>
<p><a href="${vscodeDeepLink}">${vscodeDeepLink}</a></p>

<h2>Connect with VS Code Insiders</h2>
<p><a href="${vscodeInsidersDeepLink}">${vscodeInsidersDeepLink}</a></p>

<h2>Connect with ChatGPT</h2>
<ol>
<li>Enable Developer Mode:<br>Settings → Connectors → Advanced → Developer mode</li>
<li>Import this MCP server:<br>Go to Connectors tab and add: ${url}</li>
<li>Use in conversations:<br>Choose the MCP server from the Plus menu</li>
</ol>
</body>
</html>`;
}
