/**
 * ProcessManager - Tracks and manages running MCP server processes
 */

import type { ChildProcess } from "node:child_process";
import type { ServerProcess } from "../types.js";

export class ProcessManager {
  private static instance: ProcessManager | null = null;
  private processes: Map<string, ChildProcess>;
  private serverInfo: Map<string, ServerProcess>;

  private constructor() {
    this.processes = new Map();
    this.serverInfo = new Map();

    // Handle cleanup on process exit
    process.on("exit", () => {
      this.cleanup();
    });

    process.on("SIGINT", () => {
      this.cleanup();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  /**
   * Register a running server process
   */
  registerServer(
    projectName: string,
    childProcess: ChildProcess,
    port: number
  ): void {
    if (!childProcess.pid) {
      throw new Error("Child process has no PID");
    }

    // Stop existing server with same name if it exists
    if (this.processes.has(projectName)) {
      this.stopServer(projectName);
    }

    this.processes.set(projectName, childProcess);
    this.serverInfo.set(projectName, {
      projectName,
      pid: childProcess.pid,
      port,
      url: `http://localhost:${port}/mcp`,
      startedAt: new Date(),
    });

    // Monitor process exit
    childProcess.on("exit", (code, signal) => {
      console.log(
        `[ProcessManager] Server "${projectName}" exited (code: ${code}, signal: ${signal})`
      );
      this.processes.delete(projectName);
      this.serverInfo.delete(projectName);
    });
  }

  /**
   * Stop a running server
   */
  stopServer(projectName: string): boolean {
    const childProcess = this.processes.get(projectName);

    if (!childProcess) {
      return false;
    }

    try {
      // Try graceful shutdown first
      childProcess.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.processes.has(projectName)) {
          childProcess.kill("SIGKILL");
        }
      }, 5000);

      this.processes.delete(projectName);
      this.serverInfo.delete(projectName);

      return true;
    } catch (error) {
      console.error(
        `[ProcessManager] Error stopping server "${projectName}":`,
        error
      );
      return false;
    }
  }

  /**
   * Get running server information
   */
  getServerInfo(projectName: string): ServerProcess | null {
    return this.serverInfo.get(projectName) || null;
  }

  /**
   * Check if a server is running
   */
  isServerRunning(projectName: string): boolean {
    const childProcess = this.processes.get(projectName);

    if (!childProcess || !childProcess.pid) {
      return false;
    }

    // Check if process is still alive
    try {
      process.kill(childProcess.pid, 0);
      return true;
    } catch {
      // Process is dead
      this.processes.delete(projectName);
      this.serverInfo.delete(projectName);
      return false;
    }
  }

  /**
   * Get all running servers
   */
  getRunningServers(): ServerProcess[] {
    const running: ServerProcess[] = [];

    for (const [projectName, info] of this.serverInfo.entries()) {
      if (this.isServerRunning(projectName)) {
        running.push(info);
      }
    }

    return running;
  }

  /**
   * Get a child process
   */
  getProcess(projectName: string): ChildProcess | null {
    return this.processes.get(projectName) || null;
  }

  /**
   * Stop all running servers
   */
  cleanup(): void {
    console.log("[ProcessManager] Cleaning up all running servers...");

    for (const projectName of this.processes.keys()) {
      this.stopServer(projectName);
    }
  }

  /**
   * Find an available port starting from the given port
   */
  async findAvailablePort(startPort: number = 3100): Promise<number> {
    const net = await import("node:net");

    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();

        server.once("error", () => {
          resolve(false);
        });

        server.once("listening", () => {
          server.close();
          resolve(true);
        });

        server.listen(port);
      });
    };

    let port = startPort;
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
      if (await isPortAvailable(port)) {
        return port;
      }
      port++;
    }

    throw new Error(
      `Could not find available port after ${maxAttempts} attempts`
    );
  }
}
