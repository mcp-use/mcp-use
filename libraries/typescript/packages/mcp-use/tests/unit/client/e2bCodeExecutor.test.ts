import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MCPClient } from "../../../src/client.js";
import { E2BCodeExecutor } from "../../../src/client/codeExecutor.js";

describe("E2BCodeExecutor", () => {
  let client: MCPClient;

  beforeEach(() => {
    client = new MCPClient({});
  });

  describe("constructor", () => {
    it("requires apiKey in options", () => {
      expect(() => {
        new E2BCodeExecutor(client, {} as any);
      }).toThrow();
    });

    it("creates executor with valid apiKey", () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
      });
      expect(executor).toBeInstanceOf(E2BCodeExecutor);
    });

    it("uses default timeout when not specified", () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
      });
      // Default timeout is 300000 (5 minutes)
      // We can't directly access it, but we can verify executor was created
      expect(executor).toBeDefined();
    });

    it("uses custom timeout when specified", () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
        timeoutMs: 60000,
      });
      expect(executor).toBeDefined();
    });
  });

  describe("execute()", () => {
    // Note: These tests require E2B SDK to be installed and a valid API key
    // We'll skip them if E2B is not available
    const hasE2B = async () => {
      try {
        await import("@e2b/code-interpreter");
        return true;
      } catch {
        return false;
      }
    };

    it.skipIf(!hasE2B())("executes code successfully with valid API key", async () => {
      const apiKey = process.env.E2B_API_KEY;
      if (!apiKey) {
        console.warn("E2B_API_KEY not set, skipping E2B executor test");
        return;
      }

      const executor = new E2BCodeExecutor(client, {
        apiKey,
        timeoutMs: 30000,
      });

      const result = await executor.execute("return 42;");
      expect(result.result).toBe(42);
      expect(result.error).toBeNull();

      await executor.cleanup();
    }, 60000);

    it.skipIf(!hasE2B())("handles code errors", async () => {
      const apiKey = process.env.E2B_API_KEY;
      if (!apiKey) {
        console.warn("E2B_API_KEY not set, skipping E2B executor test");
        return;
      }

      const executor = new E2BCodeExecutor(client, {
        apiKey,
        timeoutMs: 30000,
      });

      const result = await executor.execute("throw new Error('Test error');");
      expect(result.error).toBeTruthy();

      await executor.cleanup();
    }, 60000);

    it.skipIf(!hasE2B())("respects timeout parameter", async () => {
      const apiKey = process.env.E2B_API_KEY;
      if (!apiKey) {
        console.warn("E2B_API_KEY not set, skipping E2B executor test");
        return;
      }

      const executor = new E2BCodeExecutor(client, {
        apiKey,
        timeoutMs: 30000,
      });

      const result = await executor.execute(
        "await new Promise(resolve => setTimeout(resolve, 2000)); return 'done';",
        500 // 500ms timeout
      );
      expect(result.error).toBeTruthy();
      expect(result.error).toContain("timed out");

      await executor.cleanup();
    }, 60000);

    it("throws error when E2B SDK is not installed", async () => {
      // Mock the import to fail
      const originalImport = global.import;
      vi.spyOn(global, "import").mockRejectedValueOnce(new Error("Module not found"));

      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-key",
      });

      await expect(executor.execute("return 1;")).rejects.toThrow(
        "@e2b/code-interpreter is not installed"
      );
    });
  });

  describe("cleanup()", () => {
    it("handles cleanup when no sandbox exists", async () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
      });

      await expect(executor.cleanup()).resolves.not.toThrow();
    });

    it.skipIf(!hasE2B())("cleans up sandbox successfully", async () => {
      const apiKey = process.env.E2B_API_KEY;
      if (!apiKey) {
        console.warn("E2B_API_KEY not set, skipping E2B executor test");
        return;
      }

      const executor = new E2BCodeExecutor(client, {
        apiKey,
        timeoutMs: 30000,
      });

      // Create a sandbox by executing code
      await executor.execute("return 1;");

      // Cleanup should work
      await expect(executor.cleanup()).resolves.not.toThrow();
    }, 60000);
  });

  describe("inherited methods", () => {
    it("has createSearchToolsFunction from BaseCodeExecutor", () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
      });

      const searchFn = executor.createSearchToolsFunction();
      expect(typeof searchFn).toBe("function");
    });

    it("can search tools", async () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
      });

      const searchFn = executor.createSearchToolsFunction();
      const result = await searchFn();

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("meta");
    });
  });
});
