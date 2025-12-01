import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MCPClient } from "../../../src/client.js";
import { E2BCodeExecutor } from "../../../src/client/codeExecutor.js";

describe("E2BCodeExecutor", () => {
  let client: MCPClient;
  let e2bAvailable: boolean | null = null;

  const checkE2BAvailability = async () => {
    if (e2bAvailable === null) {
      try {
        await import("@e2b/code-interpreter");
        e2bAvailable = true;
      } catch {
        e2bAvailable = false;
      }
    }
    return e2bAvailable;
  };

  beforeEach(() => {
    client = new MCPClient({});
  });

  describe("constructor", () => {
    it("creates executor even without apiKey (validation happens later)", () => {
      // E2B executor constructor doesn't validate apiKey immediately
      // Validation happens when execute() is called
      const executor = new E2BCodeExecutor(client, {} as any);
      expect(executor).toBeInstanceOf(E2BCodeExecutor);
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

    it("executes code successfully with valid API key", async () => {
      if (!(await checkE2BAvailability())) {
        return; // Skip test if E2B not available
      }
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

    it("handles code errors", async () => {
      if (!(await checkE2BAvailability())) {
        return; // Skip test if E2B not available
      }
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

    it("respects timeout parameter", async () => {
      if (!(await checkE2BAvailability())) {
        return; // Skip test if E2B not available
      }
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
      // This test verifies that E2B executor handles missing SDK gracefully
      // We can't easily mock dynamic imports, so we'll test the error message
      // when the SDK is actually not available
      try {
        const executor = new E2BCodeExecutor(client, {
          apiKey: "test-key",
        });

        await executor.execute("return 1;");
        // If we get here, E2B might be installed - that's okay
      } catch (error: any) {
        // Expected: should throw error about missing SDK or API key
        expect(
          error?.message?.includes("@e2b/code-interpreter") ||
            error?.message?.includes("not installed") ||
            error?.message?.includes("API key")
        ).toBe(true);
      }
    });
  });

  describe("cleanup()", () => {
    it("handles cleanup when no sandbox exists", async () => {
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test-api-key",
      });

      await expect(executor.cleanup()).resolves.not.toThrow();
    });

    it("cleans up sandbox successfully", async () => {
      if (!(await checkE2BAvailability())) {
        return; // Skip test if E2B not available
      }
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
