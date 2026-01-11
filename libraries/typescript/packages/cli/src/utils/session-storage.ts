import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface SessionConfig {
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  authToken?: string;
  lastUsed: string;
  serverInfo?: {
    name: string;
    version?: string;
  };
  capabilities?: Record<string, unknown>;
}

export interface SessionStorage {
  activeSession: string | null;
  sessions: Record<string, SessionConfig>;
}

const SESSION_FILE_PATH = join(homedir(), ".mcp-use", "cli-sessions.json");

/**
 * Ensure the session storage directory exists
 */
async function ensureSessionDir(): Promise<void> {
  const dir = join(homedir(), ".mcp-use");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Load persisted sessions from disk
 */
export async function loadSessions(): Promise<SessionStorage> {
  try {
    await ensureSessionDir();

    if (!existsSync(SESSION_FILE_PATH)) {
      return { activeSession: null, sessions: {} };
    }

    const content = await readFile(SESSION_FILE_PATH, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    // If file doesn't exist or is invalid, return empty storage
    return { activeSession: null, sessions: {} };
  }
}

/**
 * Save sessions to disk
 */
async function saveSessions(storage: SessionStorage): Promise<void> {
  await ensureSessionDir();
  await writeFile(SESSION_FILE_PATH, JSON.stringify(storage, null, 2), "utf-8");
}

/**
 * Save or update a session configuration
 */
export async function saveSession(
  name: string,
  config: SessionConfig
): Promise<void> {
  const storage = await loadSessions();
  storage.sessions[name] = {
    ...config,
    lastUsed: new Date().toISOString(),
  };

  // Set as active session if no active session exists
  if (!storage.activeSession) {
    storage.activeSession = name;
  }

  await saveSessions(storage);
}

/**
 * Remove a session from storage
 */
export async function removeSession(name: string): Promise<void> {
  const storage = await loadSessions();
  delete storage.sessions[name];

  // Clear active session if it was the one removed
  if (storage.activeSession === name) {
    // Set to first available session or null
    const sessionNames = Object.keys(storage.sessions);
    storage.activeSession = sessionNames.length > 0 ? sessionNames[0] : null;
  }

  await saveSessions(storage);
}

/**
 * Get the currently active session name
 */
export async function getActiveSessionName(): Promise<string | null> {
  const storage = await loadSessions();
  return storage.activeSession;
}

/**
 * Get the active session configuration
 */
export async function getActiveSession(): Promise<{
  name: string;
  config: SessionConfig;
} | null> {
  const storage = await loadSessions();
  if (!storage.activeSession || !storage.sessions[storage.activeSession]) {
    return null;
  }

  return {
    name: storage.activeSession,
    config: storage.sessions[storage.activeSession],
  };
}

/**
 * Get a specific session configuration by name
 */
export async function getSession(name: string): Promise<SessionConfig | null> {
  const storage = await loadSessions();
  return storage.sessions[name] || null;
}

/**
 * Set the active session
 */
export async function setActiveSession(name: string): Promise<void> {
  const storage = await loadSessions();

  if (!storage.sessions[name]) {
    throw new Error(`Session '${name}' not found`);
  }

  storage.activeSession = name;
  storage.sessions[name].lastUsed = new Date().toISOString();

  await saveSessions(storage);
}

/**
 * List all stored sessions
 */
export async function listAllSessions(): Promise<
  Array<{ name: string; config: SessionConfig; isActive: boolean }>
> {
  const storage = await loadSessions();

  return Object.entries(storage.sessions).map(([name, config]) => ({
    name,
    config,
    isActive: name === storage.activeSession,
  }));
}

/**
 * Update session info after connection
 */
export async function updateSessionInfo(
  name: string,
  serverInfo: { name: string; version?: string },
  capabilities?: Record<string, unknown>
): Promise<void> {
  const storage = await loadSessions();

  if (storage.sessions[name]) {
    storage.sessions[name].serverInfo = serverInfo;
    storage.sessions[name].capabilities = capabilities;
    storage.sessions[name].lastUsed = new Date().toISOString();
    await saveSessions(storage);
  }
}
