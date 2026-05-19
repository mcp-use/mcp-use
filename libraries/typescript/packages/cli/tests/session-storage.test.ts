import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Redirect ~/.mcp-use to a per-run temp dir so this test can never wipe the
// developer's real `cli-sessions.json`. session-storage.ts derives its file
// path from node:os.homedir(), so mocking that here is enough. vi.mock is
// hoisted above imports, so the factory runs before session-storage loads.
vi.mock("node:os", async (importActual) => {
  const actual = await importActual<typeof import("node:os")>();
  const fakeHome = actual.tmpdir
    ? `${actual.tmpdir()}/mcp-use-cli-sessions-test-${process.pid}`
    : `/tmp/mcp-use-cli-sessions-test-${process.pid}`;
  return { ...actual, homedir: () => fakeHome };
});

import {
  saveSession,
  getSession,
  removeSession,
  listAllSessions,
  updateSessionInfo,
  loadSessions,
  type SessionConfig,
} from "../src/utils/session-storage.js";

const FAKE_HOME = homedir();
const TEST_SESSION_DIR = join(FAKE_HOME, ".mcp-use");
const TEST_SESSION_FILE = join(TEST_SESSION_DIR, "cli-sessions.json");

describe("Session Storage", () => {
  beforeAll(() => {
    mkdirSync(TEST_SESSION_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (existsSync(TEST_SESSION_FILE)) {
      rmSync(TEST_SESSION_FILE, { force: true });
    }
    if (!existsSync(TEST_SESSION_DIR)) {
      mkdirSync(TEST_SESSION_DIR, { recursive: true });
    }
    writeFileSync(TEST_SESSION_FILE, JSON.stringify({ sessions: {} }), "utf-8");
  });

  afterEach(() => {
    if (existsSync(TEST_SESSION_FILE)) {
      rmSync(TEST_SESSION_FILE, { force: true });
    }
  });

  describe("saveSession", () => {
    it("saves a new session", async () => {
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

    it("updates lastUsed timestamp on save", async () => {
      const config: SessionConfig = {
        type: "http",
        url: "http://localhost:3000/mcp",
        lastUsed: "2020-01-01T00:00:00.000Z",
      };

      await saveSession("test-session", config);

      const retrieved = await getSession("test-session");
      expect(retrieved?.lastUsed).not.toBe("2020-01-01T00:00:00.000Z");
    });

    it("saves stdio session configuration", async () => {
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
    it("returns null for non-existent session", async () => {
      const session = await getSession("non-existent");
      expect(session).toBeNull();
    });

    it("retrieves a saved session", async () => {
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

  describe("removeSession", () => {
    it("removes a session", async () => {
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

    it("leaves other sessions intact", async () => {
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
      await removeSession("session-1");

      expect(await getSession("session-1")).toBeNull();
      expect(await getSession("session-2")).not.toBeNull();
    });
  });

  describe("listAllSessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const sessions = await listAllSessions();
      expect(sessions).toEqual([]);
    });

    it("lists all saved sessions", async () => {
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

      const sessions = await listAllSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.name).sort()).toEqual([
        "session-1",
        "session-2",
      ]);
    });
  });

  describe("updateSessionInfo", () => {
    it("updates server info and capabilities", async () => {
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

    it("does not throw for non-existent session", async () => {
      await expect(
        updateSessionInfo("non-existent", { name: "test-server" }, {})
      ).resolves.not.toThrow();
    });
  });

  describe("legacy file compatibility", () => {
    it("ignores legacy activeSession field on load", async () => {
      // Older clients persisted `activeSession`. The new schema drops it but
      // should still read the rest of the file.
      writeFileSync(
        TEST_SESSION_FILE,
        JSON.stringify({
          activeSession: "session-1",
          sessions: {
            "session-1": {
              type: "http",
              url: "http://localhost:3000/mcp",
              lastUsed: new Date().toISOString(),
            },
          },
        }),
        "utf-8"
      );

      const storage = await loadSessions();
      expect(storage.sessions["session-1"]).toBeDefined();
      // activeSession is silently dropped on load.
      expect((storage as any).activeSession).toBeUndefined();
    });
  });
});
