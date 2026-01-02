/**
 * Utility functions for generating MCP client configurations and commands
 */

/**
 * Sanitize server name for use in filenames and environment variables
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
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
 * Generate Cursor deep link URL
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
 * Generate VS Code deep link URL
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
 * Generate .mcpb configuration object for Claude Desktop
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
 * Download .mcpb file
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
 * Generate Claude Code CLI command
 */
export function generateClaudeCodeCommand(
  url: string,
  name: string,
  headers?: Record<string, string>
): { command: string; envVars: Array<{ name: string; header: string }> } {
  const sanitizedName = sanitizeServerName(name);
  let command = `claude mcp add --transport http "${sanitizedName}" \\\n    "${url}"`;

  const envVars: Array<{ name: string; header: string }> = [];

  if (headers && Object.keys(headers).length > 0) {
    for (const [headerName] of Object.entries(headers)) {
      const envVar = headerToEnvVar(headerName);
      command += ` \\\n    --header '${headerName}:\${${envVar}}'`;
      envVars.push({ name: envVar, header: headerName });
    }
  }

  return { command, envVars };
}

/**
 * Generate Gemini CLI command
 */
export function generateGeminiCLICommand(
  url: string,
  name: string,
  headers?: Record<string, string>
): { command: string; envVars: Array<{ name: string; header: string }> } {
  const sanitizedName = sanitizeServerName(name);
  let command = `gemini mcp add --transport http "${sanitizedName}" "${url}"`;

  const envVars: Array<{ name: string; header: string }> = [];

  if (headers && Object.keys(headers).length > 0) {
    for (const [headerName] of Object.entries(headers)) {
      const envVar = headerToEnvVar(headerName);
      command += ` \\\n  --header '${headerName}:\${${envVar}}'`;
      envVars.push({ name: envVar, header: headerName });
    }
  }

  return { command, envVars };
}

/**
 * Generate Codex CLI configuration
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
 * Get environment variable setup instructions
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
