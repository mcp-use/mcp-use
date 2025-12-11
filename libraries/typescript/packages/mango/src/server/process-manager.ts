import type { ChildProcess } from "node:child_process";
import { execa } from "execa";

export interface ServerProcess {
  projectName: string;
  port: number;
  process: ChildProcess;
  url: string;
  startedAt: Date;
  logs?: string[];
}

/**
 * Manages running MCP server processes
 */
class ProcessManager {
  private processes: Map<string, ServerProcess> = new Map();

  /**
   * Start an MCP server
   */
  async startServer(
    projectPath: string,
    projectName: string,
    port?: number
  ): Promise<ServerProcess> {
    // Stop existing server if running
    if (this.processes.has(projectName)) {
      await this.stopServer(projectName);
    }

    // Determine port
    const serverPort = port || 3000;

    try {
      // Start the server using tsx or node
      const childProcess = execa("npm", ["start"], {
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: serverPort.toString(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const serverProcess: ServerProcess = {
        projectName,
        port: serverPort,
        process: childProcess,
        url: `http://localhost:${serverPort}`,
        startedAt: new Date(),
      };

      this.processes.set(projectName, serverProcess);

      // Capture stdout/stderr for logs
      const logs: string[] = [];

      childProcess.stdout?.on("data", (data) => {
        const log = data.toString();
        logs.push(log);
        console.log(`[${projectName}] ${log}`);
      });

      childProcess.stderr?.on("data", (data) => {
        const log = data.toString();
        logs.push(log);
        console.error(`[${projectName}] ${log}`);
      });

      // Handle process exit
      childProcess.on("exit", (code: number | null) => {
        console.log(`Server ${projectName} exited with code ${code}`);
        this.processes.delete(projectName);
      });

      // Store logs
      (serverProcess as any).logs = logs;

      // Wait a bit for the server to start
      await new Promise((resolve) => setTimeout(resolve, 3000));

      return serverProcess;
    } catch (error) {
      throw new Error(`Failed to start server: ${error}`);
    }
  }

  /**
   * Stop a running server
   */
  async stopServer(projectName: string): Promise<void> {
    const serverProcess = this.processes.get(projectName);

    if (!serverProcess) {
      return;
    }

    try {
      serverProcess.process.kill();
      this.processes.delete(projectName);
    } catch (error) {
      console.error(`Error stopping server ${projectName}:`, error);
    }
  }

  /**
   * Get all running servers
   */
  getRunningServers(): ServerProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get server status
   */
  getServerStatus(projectName: string): ServerProcess | undefined {
    return this.processes.get(projectName);
  }

  /**
   * Check if server is running
   */
  isServerRunning(projectName: string): boolean {
    return this.processes.has(projectName);
  }

  /**
   * Stop all servers
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.processes.keys()).map((name) =>
      this.stopServer(name)
    );
    await Promise.all(stopPromises);
  }
}

// Singleton instance
export const processManager = new ProcessManager();

// Cleanup on exit
process.on("exit", () => {
  processManager.stopAll();
});

process.on("SIGINT", () => {
  processManager.stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  processManager.stopAll();
  process.exit(0);
});
