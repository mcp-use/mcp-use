/**
 * Utility functions for generating MCP client configurations and commands
 */

/**
 * Sanitizes a server name for use in filenames and environment variables.
 *
 * @param name - The original server name
 * @returns The input with characters other than letters, digits, hyphens, or underscores replaced by `_`, then converted to lowercase
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
}

/**
 * Convert an HTTP header name into a safe environment variable identifier.
 *
 * @param headerName - The HTTP header name to convert
 * @returns The resulting environment variable name with non-alphanumeric characters replaced by underscores, converted to uppercase, and with leading/trailing underscores removed
 * Escape a string for safe use in shell commands
 * Wraps the string in single quotes and escapes any single quotes within it
 */
function escapeShellArg(arg: string): string {
  // Replace single quotes with the sequence: end quote, escaped quote, start quote
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Convert header name to environment variable name
 */
function headerToEnvVar(headerName: string): string {
  return headerName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase()
    .replace(/^_+|_+$/g, "");
}

/**
 * Builds a Cursor deep link that installs an MCP configured with the provided URL and optional headers.
 *
 * @param name - Display name for the server; will be sanitized for use in the link
 * @param headers - Optional mapping of header names to values; headers are represented in the generated config as environment-variable placeholders (e.g., `{{HEADER_ENV_VAR}}`)
 * @returns A Cursor deep link URL containing a base64-encoded JSON config with the `url` and optional header placeholders, and a sanitized `name` query parameter
 */
export function generateCursorDeepLink(
  url: string,
  name: string,
  headers?: Record<string, string>
): string {
  const config: Record<string, any> = { url };

  if (headers && Object.keys(headers).length > 0) {
    const headersWithEnvVars: Record<string, string> = {};
    for (const [key] of Object.entries(headers)) {
      const envVar = headerToEnvVar(key);
      headersWithEnvVars[key] = `{{${envVar}}}`;
    }
    config.headers = headersWithEnvVars;
  }

  const configJson = JSON.stringify(config);
  const base64Config = btoa(configJson);
  return `cursor://anysphere.cursor-deeplink/mcp/install?config=${base64Config}&name=${encodeURIComponent(sanitizeServerName(name))}`;
}

/**
 * Build a VS Code deep link that installs an MCP server configuration.
 *
 * If `headers` are provided, each header name is mapped to a placeholder value of the form `your-<ENVVAR>-value`.
 *
 * @param url - The server URL to include in the configuration
 * @param name - The display name for the server; it will be sanitized for use in the config
 * @param headers - Optional map of HTTP header names to values; header names are converted to environment-variable-style placeholders in the generated config
 * @returns A VS Code deep link (`vscode:mcp/install?...`) containing the URL-encoded JSON configuration
 */
export function generateVSCodeDeepLink(
  url: string,
  name: string,
  headers?: Record<string, string>
): string {
  const config: Record<string, any> = {
    url,
    name: sanitizeServerName(name),
    type: "http",
  };

  if (headers && Object.keys(headers).length > 0) {
    const headersWithPlaceholder: Record<string, string> = {};
    for (const [key] of Object.entries(headers)) {
      const envVar = headerToEnvVar(key);
      headersWithPlaceholder[key] = `your-${envVar}-value`;
    }
    config.headers = headersWithPlaceholder;
  }

  const configJson = JSON.stringify(config);
  const urlEncodedConfig = encodeURIComponent(configJson);
  return `vscode:mcp/install?${urlEncodedConfig}`;
}

/**
 * Builds a .mcpb configuration object for an MCP server.
 *
 * @param url - The server URL to include in the configuration
 * @param name - The server name; it will be sanitized for use in the config
 * @param headers - Optional mapping of header names to values; when provided each header value is replaced with a placeholder of the form `your-ENVVAR-value` where `ENVVAR` is derived from the header name
 * @returns An object containing `url`, a sanitized `name`, and, if provided, a `headers` mapping of header names to placeholder values
 */
export function generateMcpbConfig(
  url: string,
  name: string,
  headers?: Record<string, string>
): object {
  const config: Record<string, any> = {
    url,
    name: sanitizeServerName(name),
  };

  if (headers && Object.keys(headers).length > 0) {
    const headersWithPlaceholder: Record<string, string> = {};
    for (const [key] of Object.entries(headers)) {
      const envVar = headerToEnvVar(key);
      headersWithPlaceholder[key] = `your-${envVar}-value`;
    }
    config.headers = headersWithPlaceholder;
  }

  return config;
}

/**
 * Triggers a browser download of a generated .mcpb configuration file.
 *
 * @param url - The MCP server URL to include in the generated configuration
 * @param name - The server name used for the configuration and as the downloaded filename (sanitized)
 * @param headers - Optional map of HTTP headers to include in the configuration
 * @throws Rethrows any error encountered while generating the configuration or initiating the download
 */
export function downloadMcpbFile(
  url: string,
  name: string,
  headers?: Record<string, string>
): void {
  try {
    const config = generateMcpbConfig(url, name, headers);
    const configString = JSON.stringify(config, null, 2);
    const BlobConstructor = (globalThis as any).Blob;
    const blob = new BlobConstructor([configString], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${sanitizeServerName(name)}.mcpb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error("Failed to download .mcpb file:", error);
    throw error;
  }
}

/**
 * Builds a Claude Code CLI command to add an MCP using HTTP transport and collects environment variable metadata for any provided headers.
 *
 * @param url - The server URL to include in the CLI command
 * @param name - The display name for the server; it will be sanitized for use in the command
 * @param headers - Optional map of header names to header values; header names will be converted to environment variable placeholders in the command
 * @returns An object containing:
 *  - `command`: the complete `claude mcp add` CLI command string with header values referenced as environment variable placeholders, and
 *  - `envVars`: an array of `{ name, header }` entries where `name` is the generated environment variable and `header` is the original header name
 */
export function generateClaudeCodeCommand(
  url: string,
  name: string,
  headers?: Record<string, string>
): { command: string; envVars: Array<{ name: string; header: string }> } {
  const sanitizedName = sanitizeServerName(name);
  let command = `claude mcp add --transport http "${sanitizedName}" \\\n    ${escapeShellArg(url)}`;

  const envVars: Array<{ name: string; header: string }> = [];

  if (headers && Object.keys(headers).length > 0) {
    for (const [headerName] of Object.entries(headers)) {
      const envVar = headerToEnvVar(headerName);
      // Escape header name to prevent shell injection
      command += ` \\\n    --header ${escapeShellArg(`${headerName}:\${${envVar}}`)}`;
      envVars.push({ name: envVar, header: headerName });
    }
  }

  return { command, envVars };
}

/**
 * Builds a Gemini CLI command to add an MCP using HTTP transport and returns any environment-variable mappings needed for headers.
 *
 * If `headers` are provided, the command includes header entries that reference environment variable placeholders, and `envVars` lists the placeholder names with their corresponding header names.
 *
 * @param url - The MCP server URL
 * @param name - A human-readable server name used to derive a sanitized identifier for the command
 * @param headers - Optional mapping of header names to values; header names are converted to environment-variable placeholders in the returned command
 * @returns An object with `command`, the assembled CLI command string, and `envVars`, an array of `{ name, header }` pairs linking environment variable names to header names
 */
export function generateGeminiCLICommand(
  url: string,
  name: string,
  headers?: Record<string, string>
): { command: string; envVars: Array<{ name: string; header: string }> } {
  const sanitizedName = sanitizeServerName(name);
  let command = `gemini mcp add --transport http "${sanitizedName}" ${escapeShellArg(url)}`;

  const envVars: Array<{ name: string; header: string }> = [];

  if (headers && Object.keys(headers).length > 0) {
    for (const [headerName] of Object.entries(headers)) {
      const envVar = headerToEnvVar(headerName);
      // Escape header name to prevent shell injection
      command += ` \\\n  --header ${escapeShellArg(`${headerName}:\${${envVar}}`)}`;
      envVars.push({ name: envVar, header: headerName });
    }
  }

  return { command, envVars };
}

/**
 * Build a Codex-style INI configuration string for an MCP server and collect environment-variable metadata for any HTTP headers.
 *
 * @param url - The server URL to include in the configuration
 * @param name - The server display name; used to produce a sanitized section key
 * @param headers - Optional mapping of HTTP header names; header keys will be added to `http_headers` in the config with placeholder values and returned as environment-variable metadata
 * @returns An object with `config`, the generated INI-style configuration string, and `envVars`, an array of `{ name, header }` pairs where `name` is the suggested environment variable and `header` is the original header name
 */
export function generateCodexConfig(
  url: string,
  name: string,
  headers?: Record<string, string>
): { config: string; envVars: Array<{ name: string; header: string }> } {
  const sanitizedName = sanitizeServerName(name);
  let config = `[mcp_servers.${sanitizedName}]\nurl = "${url}"`;

  const envVars: Array<{ name: string; header: string }> = [];

  if (headers && Object.keys(headers).length > 0) {
    const headerEntries: string[] = [];
    for (const [headerName] of Object.entries(headers)) {
      const envVar = headerToEnvVar(headerName);
      headerEntries.push(`"${headerName}" = "your-${envVar}-value"`);
      envVars.push({ name: envVar, header: headerName });
    }
    config += `\nhttp_headers = { ${headerEntries.join(", ")} }`;

    // Add comment about environment variable alternative
    if (envVars.length > 0) {
      config += `\n\n# (optional) Use environment variables instead:\n# env_http_headers = { `;
      const envHeaderEntries = envVars.map(
        ({ name, header }) => `"${header}" = "${name}"`
      );
      config += envHeaderEntries.join(", ");
      config += ` }`;
    }
  }

  return { config, envVars };
}

/**
 * Generate shell instructions to export required environment variables.
 *
 * @param envVars - Array of environment variable metadata; each item should include `name` (the environment variable name) and `header` (the corresponding HTTP header)
 * @returns A shell snippet that exports each environment variable (one `export NAME="your-NAME-value"` line per variable), or an empty string if `envVars` is empty
 */
export function getEnvVarInstructions(
  envVars: Array<{ name: string; header: string }>
): string {
  if (envVars.length === 0) return "";

  let instructions = "Set these environment variables in your shell:\n\n";
  for (const { name } of envVars) {
    instructions += `export ${name}="your-${name}-value"\n`;
  }

  return instructions;
}

/**
 * Produce a TypeScript code snippet that initializes an MCPClient configured for the given server.
 *
 * @param url - The server URL to include in the generated client configuration
 * @param name - The human-readable server name used when deriving a default server id
 * @param serverId - Optional explicit server id to use instead of a sanitized `name`
 * @param headers - Optional HTTP headers to include in the server configuration
 * @returns A TypeScript code snippet (as a string) that registers the server with MCPClient, creates sessions, and demonstrates common session operations
 */
export function generateTypeScriptSDKCode(
  url: string,
  name: string,
  serverId?: string,
  headers?: Record<string, string>
): string {
  const id = serverId || sanitizeServerName(name);
  const serverConfig: Record<string, unknown> = {
    url,
  };

  if (headers && Object.keys(headers).length > 0) {
    serverConfig.headers = headers;
  }

  const configString = JSON.stringify(serverConfig, null, 4);
  const indentedConfig = configString
    .split("\n")
    .map((line, i) => (i === 0 ? line : "    " + line))
    .join("\n");

  return `import { MCPClient } from "mcp-use";

const client = new MCPClient({
  mcpServers: {
    "${id}": ${indentedConfig}
  }
});

await client.createAllSessions();

const session = client.getSession("${id}");

// Get available tools
const tools = await session.listTools();
console.log('Available tools:', tools.map(tool => tool.name));

// Get available resources
const resources = await session.listResources();
console.log('Available resources:', resources.map(resource => resource.name));

// Call a tool (example)
// const result = await session.callTool("toolName", { param: "value" });

// Read a resource (example)
// const resourceContent = await session.readResource("resource-uri");`;
}

/**
 * Produce a Python code snippet that initializes an MCPClient with the provided server configuration and demonstrates basic session usage.
 *
 * @param url - The MCP server URL to include in the generated configuration.
 * @param name - The server name; used to derive a sanitized identifier when `serverId` is not provided.
 * @param serverId - Optional explicit server identifier to use in the config; if omitted, a sanitized form of `name` is used.
 * @param headers - Optional HTTP headers to include in the server configuration (mapped directly into the generated config).
 * @returns A Python source string that defines an `MCPClient` configured with the specified server and includes example calls for creating sessions, listing tools/resources, and placeholders for tool/resource usage.
 */
export function generatePythonSDKCode(
  url: string,
  name: string,
  serverId?: string,
  headers?: Record<string, string>
): string {
  const id = serverId || sanitizeServerName(name);
  const serverConfig: Record<string, unknown> = {
    url,
  };

  if (headers && Object.keys(headers).length > 0) {
    serverConfig.headers = headers;
  }

  const configString = JSON.stringify(serverConfig, null, 4);
  const indentedConfig = configString
    .split("\n")
    .map((line, i) => (i === 0 ? line : "        " + line))
    .join("\n");

  return `from mcp_use import MCPClient

client = MCPClient(config={
    "mcpServers": {
        "${id}": ${indentedConfig}
    }
})

await client.create_all_sessions()

session = client.get_session("${id}")

# Get available tools
tools = await session.list_tools()
print(f"Available tools: {[tool.name for tool in tools]}")

# Get available resources
resources = await session.list_resources()
print(f"Available resources: {[resource.name for resource in resources]}")

# Call a tool (example)
# result = await session.call_tool("tool_name", {"param": "value"})

# Read a resource (example)
# resource_content = await session.read_resource("resource_uri")`;
}
