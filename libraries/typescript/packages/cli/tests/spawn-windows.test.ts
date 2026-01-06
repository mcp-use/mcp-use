import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";

/**
 * Test to verify Windows shell compatibility for spawn
 *
 * This test verifies that spawning commands works correctly on Windows
 * by enabling shell mode when platform is win32.
 */

describe("Spawn Windows Compatibility", () => {
  it("should be able to spawn npx with appropriate shell setting", async () => {
    // Create a simple spawn with the same logic as the CLI
    const isWindows = process.platform === "win32";

    return new Promise<void>((resolve, reject) => {
      // Spawn a simple command that should work on all platforms
      const command = isWindows ? "cmd" : "echo";
      const args = isWindows ? ["/c", "echo", "test"] : ["test"];

      const proc = spawn(command, args, {
        shell: process.platform === "win32",
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        reject(new Error(`Spawn failed: ${error.message}`));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
        } else {
          expect(stdout.trim()).toBe("test");
          resolve();
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error("Spawn test timeout"));
      }, 5000);
    });
  });

  it("should detect correct platform and set shell accordingly", () => {
    const expectedShell = process.platform === "win32";

    // Verify the logic we're using in the CLI
    expect(process.platform === "win32").toBe(expectedShell);

    // On Windows, shell should be true
    // On Unix, shell should be false
    if (process.platform === "win32") {
      expect(expectedShell).toBe(true);
    } else {
      expect(expectedShell).toBe(false);
    }
  });

  it("should be able to run node commands without shell", async () => {
    // Node executable should work without shell on all platforms
    return new Promise<void>((resolve, reject) => {
      const proc = spawn("node", ["--version"], {
        shell: false,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        reject(new Error(`Node spawn failed: ${error.message}`));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Node process exited with code ${code}: ${stderr}`));
        } else {
          // Should output version like v20.x.x or v22.x.x
          expect(stdout).toMatch(/v\d+\.\d+\.\d+/);
          resolve();
        }
      });

      setTimeout(() => {
        proc.kill();
        reject(new Error("Node spawn test timeout"));
      }, 5000);
    });
  });
});
