/**
 * FileSystem Session Store
 *
 * Development-friendly session storage that persists to disk.
 * Sessions survive server hot reloads, eliminating the need for client re-initialization.
 *
 * Designed for:
 * - Development environments with hot reload (tsx, nodemon, etc.)
 * - Single-instance deployments requiring session persistence
 * - Testing scenarios where session state needs to persist
 *
 * Not suitable for:
 * - Production deployments (use InMemorySessionStore or RedisSessionStore)
 * - Distributed/clustered deployments (use RedisSessionStore)
 * - High-throughput scenarios (frequent disk I/O may impact performance)
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionMetadata } from "../session-manager.js";
import type { SessionStore } from "./index.js";

/**
 * Configuration for FileSystem session store
 */
export interface FileSystemSessionStoreConfig {
  /**
   * Path to the session file (default: .mcp-use/sessions.json in project root)
   */
  path?: string;

  /**
   * Debounce delay in milliseconds for write operations (default: 100)
   * Reduces disk I/O by batching rapid consecutive writes
   */
  debounceMs?: number;

  /**
   * Maximum session age in milliseconds (default: 24 hours)
   * Sessions older than this are cleaned up on load
   */
  maxAgeMs?: number;
}

/**
 * FileSystem-based session storage (default for development mode)
 *
 * Persists session metadata to a JSON file on disk, enabling sessions to survive
 * server restarts during hot reload. Uses atomic writes and debouncing for reliability.
 *
 * @example
 * ```typescript
 * import { MCPServer, FileSystemSessionStore } from 'mcp-use/server';
 *
 * const server = new MCPServer({
 *   name: 'dev-server',
 *   version: '1.0.0',
 *   sessionStore: new FileSystemSessionStore({
 *     path: '.mcp-use/sessions.json'
 *   })
 * });
 * ```
 */
export class FileSystemSessionStore implements SessionStore {
  private sessions = new Map<string, SessionMetadata>();
  private readonly filePath: string;
  private readonly debounceMs: number;
  private readonly maxAgeMs: number;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving = false;
  private pendingSave = false;

  constructor(config: FileSystemSessionStoreConfig = {}) {
    this.filePath =
      config.path ?? join(process.cwd(), ".mcp-use", "sessions.json");
    this.debounceMs = config.debounceMs ?? 100;
    this.maxAgeMs = config.maxAgeMs ?? 24 * 60 * 60 * 1000; // 24 hours

    // Load existing sessions synchronously on construction
    this.loadSessionsSync();
  }

  /**
   * Load sessions from file synchronously during construction
   * This ensures sessions are available immediately when the server starts
   */
  private loadSessionsSync(): void {
    try {
      if (!existsSync(this.filePath)) {
        console.log(
          `[FileSystemSessionStore] No session file found at ${this.filePath}, starting fresh`
        );
        return;
      }

      const data = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(data);
      const now = Date.now();

      // Clean up expired sessions during load
      for (const [sessionId, metadata] of Object.entries(parsed)) {
        const sessionMetadata = metadata as SessionMetadata;
        const age = now - sessionMetadata.lastAccessedAt;

        if (age > this.maxAgeMs) {
          continue; // Skip expired sessions
        }

        this.sessions.set(sessionId, sessionMetadata);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        // File doesn't exist - this is fine for first run
        console.log(`[FileSystemSessionStore] No existing sessions file`);
      } else if (error instanceof SyntaxError) {
        // Corrupted JSON - start fresh
        console.warn(
          `[FileSystemSessionStore] Corrupted session file, starting fresh:`,
          error.message
        );
      } else {
        // Other errors (permissions, etc.) - log but continue
        console.warn(
          `[FileSystemSessionStore] Error loading sessions, starting fresh:`,
          error.message
        );
      }
    }
  }

  /**
   * Retrieve session metadata by ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    const data = this.sessions.get(sessionId);
    return data ?? null;
  }

  /**
   * Store or update session metadata
   * Uses debouncing to batch rapid consecutive writes
   */
  async set(sessionId: string, data: SessionMetadata): Promise<void> {
    this.sessions.set(sessionId, data);
    await this.scheduleSave();
  }

  /**
   * Delete session metadata
   */
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await this.scheduleSave();
  }

  /**
   * Check if session exists
   */
  async has(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  /**
   * List all session IDs
   */
  async keys(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  /**
   * Store session metadata with TTL
   * Note: TTL is enforced on load, not with timers (simple implementation)
   */
  async setWithTTL(
    sessionId: string,
    data: SessionMetadata,
    ttlMs: number
  ): Promise<void> {
    // Store the expiry time in metadata for cleanup on next load
    const metadataWithExpiry = {
      ...data,
      lastAccessedAt: Date.now(),
    };
    this.sessions.set(sessionId, metadataWithExpiry);
    await this.scheduleSave();

    // Schedule cleanup using setTimeout as fallback
    setTimeout(() => {
      this.sessions.delete(sessionId);
      this.scheduleSave();
    }, ttlMs);
  }

  /**
   * Get the number of active sessions
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions
   */
  async clear(): Promise<void> {
    this.sessions.clear();
    await this.scheduleSave();
  }

  /**
   * Schedule a save operation with debouncing
   * Prevents excessive disk I/O from rapid consecutive writes
   */
  private async scheduleSave(): Promise<void> {
    // If already saving, mark that another save is pending
    if (this.saving) {
      this.pendingSave = true;
      return;
    }

    // Clear existing timer if any
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    // Schedule new save after debounce delay
    this.saveTimer = setTimeout(() => {
      this.performSave();
    }, this.debounceMs);
  }

  /**
   * Perform the actual save operation with atomic writes
   * Uses write-to-temp-then-rename pattern to prevent corruption
   */
  private async performSave(): Promise<void> {
    this.saveTimer = null;
    this.saving = true;
    this.pendingSave = false;

    try {
      // Ensure directory exists
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });

      // Convert Map to plain object for JSON serialization
      const data: Record<string, SessionMetadata> = {};
      for (const [sessionId, metadata] of Array.from(this.sessions.entries())) {
        data[sessionId] = metadata;
      }

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await rename(tempPath, this.filePath);

      // Silently save sessions without logging to reduce noise
      // console.debug(
      //   `[FileSystemSessionStore] Saved ${this.sessions.size} session(s) to ${this.filePath}`
      // );
    } catch (error: any) {
      console.error(
        `[FileSystemSessionStore] Error saving sessions:`,
        error.message
      );

      // Clean up temp file if it exists
      try {
        const tempPath = `${this.filePath}.tmp`;
        if (existsSync(tempPath)) {
          await unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    } finally {
      this.saving = false;

      // If another save was requested during this save, perform it now
      if (this.pendingSave) {
        await this.scheduleSave();
      }
    }
  }

  /**
   * Force an immediate save (bypasses debouncing)
   * Useful for ensuring persistence before process exit
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.performSave();
  }
}
