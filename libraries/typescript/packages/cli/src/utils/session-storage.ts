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
  /** Static Bearer token. Used when authMode is undefined or "bearer". */
  authToken?: string;
  /**
   * How this session authenticates to the server.
   * - "bearer": static token in `authToken`.
   * - "oauth": tokens live in `~/.mcp-use/oauth/<urlHash>/`, managed by NodeOAuthClientProvider.
   * Undefined = legacy bearer (back-compat with sessions saved before OAuth shipped).
   */
  authMode?: "bearer" | "oauth";
  lastUsed: string;
  serverInfo?: {
    name: string;
    version?: string;
  };
  capabilities?: Record<string, unknown>;
}

export interface SessionStorage {
  sessions: Record<string, SessionConfig>;
}

const SESSION_FILE_PATH = join(homedir(), ".mcp-use", "cli-sessions.json");

let _dirEnsured = false;
async function ensureSessionDir(): Promise<void> {
  if (_dirEnsured) return;
  // `mkdir({ recursive: true })` is a no-op when the dir already exists, so
  // we don't need a separate `existsSync` check.
  await mkdir(join(homedir(), ".mcp-use"), { recursive: true });
  _dirEnsured = true;
}

/**
 * Load persisted servers from disk.
 *
 * Tolerates older files that include an `activeSession` field — the field is
 * silently dropped. The CLI no longer tracks an active server; every command
 * names its target explicitly.
 */
export async function loadSessions(): Promise<SessionStorage> {
  try {
    await ensureSessionDir();

    if (!existsSync(SESSION_FILE_PATH)) {
      return { sessions: {} };
    }

    const content = await readFile(SESSION_FILE_PATH, "utf-8");
    const parsed = JSON.parse(content);
    return { sessions: parsed?.sessions ?? {} };
  } catch {
    return { sessions: {} };
  }
}

async function saveSessions(storage: SessionStorage): Promise<void> {
  await ensureSessionDir();
  await writeFile(SESSION_FILE_PATH, JSON.stringify(storage, null, 2), "utf-8");
}

export async function saveSession(
  name: string,
  config: SessionConfig
): Promise<void> {
  const storage = await loadSessions();
  storage.sessions[name] = {
    ...config,
    lastUsed: new Date().toISOString(),
  };
  await saveSessions(storage);
}

export async function removeSession(name: string): Promise<void> {
  const storage = await loadSessions();
  delete storage.sessions[name];
  await saveSessions(storage);
}

export async function getSession(name: string): Promise<SessionConfig | null> {
  const storage = await loadSessions();
  return storage.sessions[name] || null;
}

export async function listAllSessions(): Promise<
  Array<{ name: string; config: SessionConfig }>
> {
  const storage = await loadSessions();
  return Object.entries(storage.sessions).map(([name, config]) => ({
    name,
    config,
  }));
}

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
