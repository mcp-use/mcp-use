import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  saveSession,
  getSession,
  getActiveSession,
  setActiveSession,
  removeSession,
  listAllSessions,
  updateSessionInfo,
  type SessionConfig,
} from "../src/utils/session-storage.js";

const TEST_SESSION_DIR = join(homedir(), ".mcp-use");
const TEST_SESSION_FILE = join(TEST_SESSION_DIR, "cli-sessions.json");

describe("Session Storage", () => {
  beforeEach(() => {
    // Clean up before each test to ensure isolation
    if (existsSync(TEST_SESSION_FILE)) {
      rmSync(TEST_SESSION_FILE, { force: true });
    }
    // Create test directory
    if (!existsSync(TEST_SESSION_DIR)) {
      mkdirSync(TEST_SESSION_DIR, { recursive: true });
    }
    // Write empty session file
    writeFileSync(
      TEST_SESSION_FILE,
      JSON.stringify({ activeSession: null, sessions: {} }),
      "utf-8"
    );
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_SESSION_FILE)) {
      rmSync(TEST_SESSION_FILE, { force: true });
    }
  });

  describe("saveSession", () => {
    it("should save a new session", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("test-session", config);

      const retrieved = await getSession("test-session");
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe("http");
      expect(retrieved?.url).toBe("http://localhost:3000/mcp");
    });

    it("should set first session as active", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("first-session", config);

      const active = await getActiveSession();
      expect(active).toBeDefined();
      expect(active?.name).toBe("first-session");
    });

    it("should update lastUsed timestamp", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: "2020-01-01T00:00:00.000Z",
      };

      await saveSession("test-session", config);

      const retrieved = await getSession("test-session");
      expect(retrieved?.lastUsed).not.toBe("2020-01-01T00:00:00.000Z");
    });

    it("should save stdio session configuration", async () => {
      const config: SessionConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        lastUsed: new Date().toISOString(),
      };

      await saveSession("stdio-session", config);

      const retrieved = await getSession("stdio-session");
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe("stdio");
      expect(retrieved?.command).toBe("npx");
      expect(retrieved?.args).toEqual([
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/tmp",
      ]);
    });
  });

  describe("getSession", () => {
    it("should return null for non-existent session", async () => {
      const session = await getSession("non-existent");
      expect(session).toBeNull();
    });

    it("should retrieve saved session", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("test-session", config);
      const retrieved = await getSession("test-session");

      expect(retrieved).toEqual(
        expect.objectContaining({
          type: "http",
          url: "http://localhost:3000/mcp",
        })
      );
    });
  });

  describe("getActiveSession", () => {
    it("should return null when no sessions exist", async () => {
      const active = await getActiveSession();
      expect(active).toBeNull();
    });

    it("should return active session", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("test-session", config);
      const active = await getActiveSession();

      expect(active).toBeDefined();
      expect(active?.name).toBe("test-session");
      expect(active?.config.type).toBe("http");
    });
  });

  describe("setActiveSession", () => {
    it("should set active session", async () => {
      const config1: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };
      const config2: SessionConfig = {
        type: "http",
        url: "http://localhost:4000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("session-1", config1);
      await saveSession("session-2", config2);
      await setActiveSession("session-2");

      const active = await getActiveSession();
      expect(active?.name).toBe("session-2");
    });

    it("should throw error for non-existent session", async () => {
      await expect(setActiveSession("non-existent")).rejects.toThrow(
        "Session 'non-existent' not found"
      );
    });

    it("should update lastUsed when setting active", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: "2020-01-01T00:00:00.000Z",
      };

      await saveSession("test-session", config);
      await setActiveSession("test-session");

      const session = await getSession("test-session");
      expect(session?.lastUsed).not.toBe("2020-01-01T00:00:00.000Z");
    });
  });

  describe("removeSession", () => {
    it("should remove a session", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("test-session", config);
      await removeSession("test-session");

      const retrieved = await getSession("test-session");
      expect(retrieved).toBeNull();
    });

    it("should update active session when removing active", async () => {
      const config1: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };
      const config2: SessionConfig = {
        type: "http",
        url: "http://localhost:4000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("session-1", config1);
      await saveSession("session-2", config2);
      await setActiveSession("session-1");
      await removeSession("session-1");

      const active = await getActiveSession();
      // Should switch to session-2 or be null if no sessions left
      expect(active?.name).not.toBe("session-1");
    });
  });

  describe("listAllSessions", () => {
    it("should return empty array when no sessions", async () => {
      const sessions = await listAllSessions();
      expect(sessions).toEqual([]);
    });

    it("should list all sessions with active flag", async () => {
      const config1: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };
      const config2: SessionConfig = {
        type: "http",
        url: "http://localhost:4000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("session-1", config1);
      await saveSession("session-2", config2);
      await setActiveSession("session-2");

      const sessions = await listAllSessions();
      expect(sessions).toHaveLength(2);

      const active = sessions.find((s) => s.isActive);
      expect(active?.name).toBe("session-2");

      const inactive = sessions.find((s) => !s.isActive);
      expect(inactive?.name).toBe("session-1");
    });
  });

  describe("updateSessionInfo", () => {
    it("should update server info and capabilities", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: new Date().toISOString(),
      };

      await saveSession("test-session", config);
      await updateSessionInfo(
        "test-session",
        { name: "test-server", version: "1.0.0" },
        { tools: {}, resources: {} }
      );

      const session = await getSession("test-session");
      expect(session?.serverInfo).toEqual({
        name: "test-server",
        version: "1.0.0",
      });
      expect(session?.capabilities).toEqual({
        tools: {},
        resources: {},
      });
    });

    it("should not fail for non-existent session", async () => {
      await expect(
        updateSessionInfo("non-existent", { name: "test-server" }, {})
      ).resolves.not.toThrow();
    });
  });
});
