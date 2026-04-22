import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpConfig {
  apiKey?: string;
  apiUrl?: string;
  orgId?: string;
  orgName?: string;
  orgSlug?: string;
  /** @deprecated Use orgId. Read for backward compat with old config files. */
  profileId?: string;
  /** @deprecated Use orgName. */
  profileName?: string;
  /** @deprecated Use orgSlug. */
  profileSlug?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".mcp-use");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Backend API URL (where /api/v1 endpoints are)
const DEFAULT_API_URL = process.env.MCP_API_URL
  ? process.env.MCP_API_URL.replace(/\/api\/v1$/, "") + "/api/v1" // Ensure /api/v1 suffix
  : "https://cloud.mcp-use.com/api/v1";

// Frontend/Web URL (where /auth/cli page is)
const DEFAULT_WEB_URL = process.env.MCP_WEB_URL
  ? process.env.MCP_WEB_URL
  : "https://manufact.com";

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (error) {
    // Ignore error if directory already exists
  }
}

/**
 * Read config from disk, migrating legacy `profile*` keys to `org*`.
 */
export async function readConfig(): Promise<McpConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    const raw = JSON.parse(content) as McpConfig;
    return {
      ...raw,
      orgId: raw.orgId ?? raw.profileId,
      orgName: raw.orgName ?? raw.profileName,
      orgSlug: raw.orgSlug ?? raw.profileSlug,
    };
  } catch (error) {
    return {};
  }
}

/**
 * Write config to disk. Persists only the new `org*` keys and removes legacy `profile*` keys.
 */
export async function writeConfig(config: McpConfig): Promise<void> {
  await ensureConfigDir();
  const { profileId: _a, profileName: _b, profileSlug: _c, ...clean } = config;
  await fs.writeFile(CONFIG_FILE, JSON.stringify(clean, null, 2), "utf-8");
}

/**
 * Delete config file
 */
export async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_FILE);
  } catch (error) {
    // Ignore error if file doesn't exist
  }
}

/**
 * Get API URL from config or use default
 */
export async function getApiUrl(): Promise<string> {
  const config = await readConfig();
  return config.apiUrl || DEFAULT_API_URL;
}

/**
 * Get API key from config
 */
export async function getApiKey(): Promise<string | null> {
  const config = await readConfig();
  return config.apiKey || null;
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(): Promise<boolean> {
  const apiKey = await getApiKey();
  return !!apiKey;
}

/**
 * Get the stored organization ID from config
 */
export async function getOrgId(): Promise<string | null> {
  const config = await readConfig();
  return config.orgId || null;
}

/**
 * Get web URL (for browser-based auth)
 * This is the frontend URL where /device verification page lives
 */
export async function getWebUrl(): Promise<string> {
  return DEFAULT_WEB_URL;
}

/**
 * Derive the auth base URL from the API URL.
 * Better Auth endpoints live at /api/auth/*, not under /api/v1/.
 * e.g. "http://localhost:8000/api/v1" -> "http://localhost:8000"
 */
export async function getAuthBaseUrl(): Promise<string> {
  const apiUrl = await getApiUrl();
  return apiUrl.replace(/\/api\/v1$/, "");
}
