import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("HMR CLI Integration", () => {
  let testDir: string;
  let serverProcess: ChildProcess | null = null;
  let port: number;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(tmpdir(), `mcp-hmr-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    port = 3000 + Math.floor(Math.random() * 1000);

    // Create package.json to enable module resolution
    const packageJson = {
      type: "module",
    };
    await writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Create node_modules/mcp-use symlink to actual built package
    const mcpUsePackagePath = path.resolve(__dirname, "../..");
    const testNodeModules = path.join(testDir, "node_modules");
    await mkdir(testNodeModules, { recursive: true });
    const mcpUseSymlink = path.join(testNodeModules, "mcp-use");

    try {
      await import("node:fs/promises").then((fs) =>
        fs.symlink(mcpUsePackagePath, mcpUseSymlink, "dir")
      );
    } catch (error) {
      // Ignore if symlink already exists or fails
    }
  });

  afterEach(async () => {
    // Kill server process
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }

    // Clean up test directory
    try {
      await import("node:fs/promises").then((fs) =>
        fs.rm(testDir, { recursive: true, force: true })
      );
    } catch {
      // Ignore cleanup errors
    }
  });

  const createTestServer = async (
    content: string
  ): Promise<{ filePath: string }> => {
    const filePath = path.join(testDir, "server.ts");
    await writeFile(filePath, content);
    return { filePath };
  };

  const startDevServer = (filePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const cliPath = path.resolve(__dirname, "../../../cli/dist/index.cjs");

      serverProcess = spawn(
        "node",
        [cliPath, "dev", "--port", String(port), "--no-open"],
        {
          cwd: testDir,
          env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: "test",
          },
        }
      );

      let output = "";
      const timeout = setTimeout(() => {
        reject(new Error(`Server start timeout. Output: ${output}`));
      }, 30000);

      serverProcess.stdout?.on("data", (data) => {
        output += data.toString();
        if (output.includes("Watching for changes")) {
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess.stderr?.on("data", (data) => {
        console.error("Server stderr:", data.toString());
      });

      serverProcess.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  };

  const waitForHMR = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!serverProcess) {
        reject(new Error("No server process"));
        return;
      }

      let output = "";
      const timeout = setTimeout(() => {
        reject(new Error(`HMR timeout. Output: ${output}`));
      }, 10000);

      const dataHandler = (data: Buffer) => {
        output += data.toString();
        if (output.includes("[HMR] ✓ Reloaded")) {
          clearTimeout(timeout);
          serverProcess?.stdout?.off("data", dataHandler);
          resolve(output);
        }
      };

      serverProcess.stdout?.on("data", dataHandler);
    });
  };

  const callTool = async (toolName: string): Promise<any> => {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: {},
        },
      }),
    });

    return response.json();
  };

  const listTools = async (): Promise<string[]> => {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const data = await response.json();
    return data.result?.tools?.map((t: any) => t.name) || [];
  };

  it(
    "should start server and detect file changes",
    { timeout: 60000 },
    async () => {
      const initialContent = `
      import { MCPServer, object } from "mcp-use/server";
      
      const server = new MCPServer({
        name: "test-server",
        version: "1.0.0",
      });
      
      server.tool(
        {
          name: "initial-tool",
          description: "Initial tool",
        },
        async () => object({ value: "initial" })
      );
      
      server.listen();
    `;

      const { filePath } = await createTestServer(initialContent);
      await startDevServer(filePath);

      // Wait for server to be ready
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify initial state
      const initialTools = await listTools();
      expect(initialTools).toContain("initial-tool");

      // Modify file to add new tool
      const updatedContent = `
      import { MCPServer, object } from "mcp-use/server";
      
      const server = new MCPServer({
        name: "test-server",
        version: "1.0.0",
      });
      
      server.tool(
        {
          name: "initial-tool",
          description: "Initial tool",
        },
        async () => object({ value: "initial" })
      );
      
      server.tool(
        {
          name: "new-hmr-tool",
          description: "Added via HMR",
        },
        async () => object({ value: "hmr-works" })
      );
      
      server.listen();
    `;

      await writeFile(filePath, updatedContent);
      const hmrOutput = await waitForHMR();

      // Verify HMR detected the change
      expect(hmrOutput).toContain("+ Tools: new-hmr-tool");
      expect(hmrOutput).toContain("[HMR] ✓ Reloaded");

      // Wait a bit for the change to propagate
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify new tool is available
      const updatedTools = await listTools();
      expect(updatedTools).toContain("initial-tool");
      expect(updatedTools).toContain("new-hmr-tool");
    }
  );

  it("should handle syntax errors gracefully", { timeout: 60000 }, async () => {
    const validContent = `
      import { MCPServer, object } from "mcp-use/server";
      
      const server = new MCPServer({
        name: "test-server",
        version: "1.0.0",
      });
      
      server.tool(
        {
          name: "test-tool",
          description: "Test tool",
        },
        async () => object({ value: "test" })
      );
      
      server.listen();
    `;

    const { filePath } = await createTestServer(validContent);
    await startDevServer(filePath);

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Introduce syntax error
    const brokenContent = `
      import { MCPServer, object } from "mcp-use/server";
      
      const server = new MCPServer({
        name: "test-server",
        version: "1.0.0",
      });
      
      server.tool(
        {
          name: "test-tool",
          description: "Test tool",
        },
        async () => object({ value: "test" })
      );
      
      // Syntax error: unclosed brace
      const broken = {
        field: "value"
    `;

    let errorOutput = "";
    const errorPromise = new Promise<string>((resolve) => {
      const stdoutHandler = (data: Buffer) => {
        errorOutput += data.toString();
        if (errorOutput.includes("[HMR] Reload failed")) {
          serverProcess?.stdout?.off("data", stdoutHandler);
          serverProcess?.stderr?.off("data", stderrHandler);
          resolve(errorOutput);
        }
      };
      const stderrHandler = (data: Buffer) => {
        errorOutput += data.toString();
        if (errorOutput.includes("[HMR] Reload failed")) {
          serverProcess?.stdout?.off("data", stdoutHandler);
          serverProcess?.stderr?.off("data", stderrHandler);
          resolve(errorOutput);
        }
      };
      serverProcess?.stdout?.on("data", stdoutHandler);
      serverProcess?.stderr?.on("data", stderrHandler);

      // Timeout after 5 seconds
      setTimeout(() => resolve(errorOutput), 5000);
    });

    await writeFile(filePath, brokenContent);
    const output = await errorPromise;

    // Verify error was caught
    expect(output).toContain("[HMR] Reload failed");

    // Verify server is still running (can still list tools)
    const tools = await listTools();
    expect(tools).toContain("test-tool");

    // Fix the error
    await writeFile(filePath, validContent);
    await waitForHMR();

    // Verify recovery
    const recoveredTools = await listTools();
    expect(recoveredTools).toContain("test-tool");
  });

  it(
    "should update tool descriptions via HMR",
    { timeout: 60000 },
    async () => {
      const initialContent = `
      import { MCPServer, object } from "mcp-use/server";
      
      const server = new MCPServer({
        name: "test-server",
        version: "1.0.0",
      });
      
      server.tool(
        {
          name: "update-test",
          description: "Original description",
        },
        async () => object({ value: "original" })
      );
      
      server.listen();
    `;

      const { filePath } = await createTestServer(initialContent);
      await startDevServer(filePath);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Update description
      const updatedContent = `
      import { MCPServer, object } from "mcp-use/server";
      
      const server = new MCPServer({
        name: "test-server",
        version: "1.0.0",
      });
      
      server.tool(
        {
          name: "update-test",
          description: "Updated via HMR",
        },
        async () => object({ value: "updated" })
      );
      
      server.listen();
    `;

      await writeFile(filePath, updatedContent);
      const hmrOutput = await waitForHMR();

      // Verify HMR detected the update
      expect(hmrOutput).toContain("~ Tools: update-test");
      expect(hmrOutput).toContain("[HMR] ✓ Reloaded");

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify tool description updated
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });

      const data = await response.json();
      const tool = data.result?.tools?.find(
        (t: any) => t.name === "update-test"
      );
      expect(tool?.description).toBe("Updated via HMR");
    }
  );
});
