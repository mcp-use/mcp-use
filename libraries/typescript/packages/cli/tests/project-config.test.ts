import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadProjectConfig,
  resolveEntryFile,
  resolveMcpDir,
  resolvePort,
  resolveWidgetsDir,
} from "../src/utils/project-config.js";

describe("project-config", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = path.join(
      tmpdir(),
      `project-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("loadProjectConfig", () => {
    it("returns {} when mcp-use.config.json is missing", async () => {
      const config = await loadProjectConfig(projectDir);
      expect(config).toEqual({});
    });

    it("parses valid JSON", async () => {
      await writeFile(
        path.join(projectDir, "mcp-use.config.json"),
        JSON.stringify({
          entry: "src/server.ts",
          mcpDir: "src/mcp",
          port: 4000,
        })
      );
      const config = await loadProjectConfig(projectDir);
      expect(config.entry).toBe("src/server.ts");
      expect(config.mcpDir).toBe("src/mcp");
      expect(config.port).toBe(4000);
    });

    it("throws a clear error for malformed JSON", async () => {
      await writeFile(
        path.join(projectDir, "mcp-use.config.json"),
        "{ not valid json"
      );
      await expect(loadProjectConfig(projectDir)).rejects.toThrow(
        /Invalid JSON in .*mcp-use\.config\.json/
      );
    });
  });

  describe("resolveMcpDir", () => {
    it("prefers CLI flag over config", () => {
      expect(resolveMcpDir("flag/dir", { mcpDir: "cfg/dir" })).toBe("flag/dir");
    });

    it("falls back to config value when no CLI flag", () => {
      expect(resolveMcpDir(undefined, { mcpDir: "cfg/dir" })).toBe("cfg/dir");
    });

    it("returns undefined when neither is set", () => {
      expect(resolveMcpDir(undefined, {})).toBeUndefined();
    });
  });

  describe("resolveWidgetsDir", () => {
    it("CLI flag wins over everything", () => {
      expect(
        resolveWidgetsDir("cli/widgets", { widgetsDir: "cfg/widgets" }, "mcp")
      ).toBe("cli/widgets");
    });

    it("config.widgetsDir wins over mcpDir default", () => {
      expect(
        resolveWidgetsDir(undefined, { widgetsDir: "cfg/widgets" }, "mcp")
      ).toBe("cfg/widgets");
    });

    it("defaults to <mcpDir>/resources when only mcpDir is set", () => {
      expect(resolveWidgetsDir(undefined, {}, "src/mcp")).toBe(
        path.join("src/mcp", "resources")
      );
    });

    it("defaults to 'resources' when nothing is set", () => {
      expect(resolveWidgetsDir(undefined, {})).toBe("resources");
    });
  });

  describe("resolveEntryFile", () => {
    it("CLI --entry wins and is asserted to exist", async () => {
      await writeFile(path.join(projectDir, "custom.ts"), "// entry");
      const resolved = await resolveEntryFile(projectDir, "custom.ts", {});
      expect(resolved).toBe("custom.ts");
    });

    it("throws when CLI --entry points at a missing file", async () => {
      await expect(
        resolveEntryFile(projectDir, "does-not-exist.ts", {})
      ).rejects.toThrow(/File not found: does-not-exist\.ts/);
    });

    it("uses config.entry as fallback", async () => {
      await writeFile(path.join(projectDir, "server.ts"), "// entry");
      const resolved = await resolveEntryFile(projectDir, undefined, {
        entry: "server.ts",
      });
      expect(resolved).toBe("server.ts");
    });

    it("prefers <mcpDir>/index.ts when mcpDir is set", async () => {
      await mkdir(path.join(projectDir, "src", "mcp"), { recursive: true });
      await writeFile(
        path.join(projectDir, "src", "mcp", "index.ts"),
        "// entry"
      );
      const resolved = await resolveEntryFile(
        projectDir,
        undefined,
        {},
        "src/mcp"
      );
      expect(resolved).toBe(path.join("src/mcp", "index.ts"));
    });

    it("falls back to <mcpDir>/index.tsx when index.ts is absent", async () => {
      await mkdir(path.join(projectDir, "src", "mcp"), { recursive: true });
      await writeFile(
        path.join(projectDir, "src", "mcp", "index.tsx"),
        "// entry"
      );
      const resolved = await resolveEntryFile(
        projectDir,
        undefined,
        {},
        "src/mcp"
      );
      expect(resolved).toBe(path.join("src/mcp", "index.tsx"));
    });

    it("throws with a mcpDir-specific error when the dir has no entry file", async () => {
      await mkdir(path.join(projectDir, "src", "mcp"), { recursive: true });
      await expect(
        resolveEntryFile(projectDir, undefined, {}, "src/mcp")
      ).rejects.toThrow(/No entry file found inside src\/mcp/);
    });

    it("uses the legacy top-level default search when no mcpDir is set", async () => {
      await writeFile(path.join(projectDir, "index.ts"), "// entry");
      const resolved = await resolveEntryFile(projectDir, undefined, {});
      expect(resolved).toBe("index.ts");
    });

    it("throws when neither mcpDir nor legacy default entry exist", async () => {
      await expect(resolveEntryFile(projectDir, undefined, {})).rejects.toThrow(
        /No entry file found/
      );
    });
  });

  describe("resolvePort", () => {
    const origEnvPort = process.env.PORT;
    afterEach(() => {
      if (origEnvPort === undefined) delete process.env.PORT;
      else process.env.PORT = origEnvPort;
    });

    it("returns the CLI value when it's a valid port", () => {
      delete process.env.PORT;
      expect(resolvePort("4321", {})).toBe(4321);
      expect(resolvePort(4321, {})).toBe(4321);
    });

    it("falls through when CLI value is NaN", () => {
      delete process.env.PORT;
      expect(resolvePort("not-a-port", { port: 5000 })).toBe(5000);
    });

    it("falls through when env PORT is NaN", () => {
      process.env.PORT = "abc";
      expect(resolvePort(undefined, { port: 5000 })).toBe(5000);
    });

    it("falls through when config.port is out of range", () => {
      delete process.env.PORT;
      expect(resolvePort(undefined, { port: 70000 })).toBe(3000);
    });

    it("returns the explicit default when every source is invalid", () => {
      process.env.PORT = "abc";
      expect(resolvePort("nope", { port: -1 }, 8080)).toBe(8080);
    });
  });
});
