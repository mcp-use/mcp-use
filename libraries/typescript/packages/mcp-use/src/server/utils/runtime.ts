/**
 * Cross-runtime utilities for Node.js and Deno compatibility
 */

// Detect runtime
export const isDeno = typeof (globalThis as any).Deno !== "undefined";

/**
 * Get an environment variable in a cross-runtime compatible way
 * Works in both Node.js and Deno environments
 * 
 * @param key - The environment variable key
 * @returns The value of the environment variable, or undefined if not set
 */
export function getEnv(key: string): string | undefined {
  if (isDeno) {
    return (globalThis as any).Deno.env.get(key);
  }
  return process.env[key];
}




// Helper to get current working directory
export function getCwd(): string {
    if (isDeno) {
      return (globalThis as any).Deno.cwd();
    }
    return process.cwd();
  }
  
  // Runtime-aware file system helpers
  export const fsHelpers = {
    async readFileSync(path: string, encoding: string = "utf8"): Promise<string> {
      if (isDeno) {
        return await (globalThis as any).Deno.readTextFile(path);
      }
      const { readFileSync } = await import("node:fs");
      const result = readFileSync(path, encoding as any);
      return typeof result === "string"
        ? result
        : result.toString(encoding as any);
    },
  
    async readFile(path: string): Promise<ArrayBuffer> {
      if (isDeno) {
        const data = await (globalThis as any).Deno.readFile(path);
        return data.buffer;
      }
      const { readFileSync } = await import("node:fs");
      const buffer = readFileSync(path);
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    },
  
    async existsSync(path: string): Promise<boolean> {
      if (isDeno) {
        try {
          await (globalThis as any).Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      }
      const { existsSync } = await import("node:fs");
      return existsSync(path);
    },
  
    async readdirSync(path: string): Promise<string[]> {
      if (isDeno) {
        const entries = [];
        for await (const entry of (globalThis as any).Deno.readDir(path)) {
          entries.push(entry.name);
        }
        return entries;
      }
      const { readdirSync } = await import("node:fs");
      return readdirSync(path);
    },
  };
  
  // Runtime-aware path helpers
  export const pathHelpers = {
    join(...paths: string[]): string {
      if (isDeno) {
        // Use simple path joining for Deno (web-standard approach)
        return paths.join("/").replace(/\/+/g, "/");
      }
      // For Node, we need to use the sync version or cache the import
      // We'll use a simple implementation that works for both
      return paths.join("/").replace(/\/+/g, "/");
    },
  
    relative(from: string, to: string): string {
      // Simple relative path calculation
      const fromParts = from.split("/").filter((p) => p);
      const toParts = to.split("/").filter((p) => p);
  
      let i = 0;
      while (
        i < fromParts.length &&
        i < toParts.length &&
        fromParts[i] === toParts[i]
      ) {
        i++;
      }
  
      const upCount = fromParts.length - i;
      const relativeParts = [...Array(upCount).fill(".."), ...toParts.slice(i)];
      return relativeParts.join("/");
    },
  };
  

  // UUID generation helper (works in Node.js, Deno, and browsers)
// Uses the Web Crypto API which is available globally
export function generateUUID(): string {
    return (globalThis.crypto as any).randomUUID();
  }