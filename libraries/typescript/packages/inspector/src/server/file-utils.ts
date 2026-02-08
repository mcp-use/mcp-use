import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Node.js-specific file system utilities for the MCP Inspector server
 */

/**
 * Get content type for static assets
 */
export function getContentType(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "application/javascript";
  } else if (filePath.endsWith(".css")) {
    return "text/css";
  } else if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  } else if (filePath.endsWith(".html")) {
    return "text/html";
  } else if (filePath.endsWith(".json")) {
    return "application/json";
  } else if (filePath.endsWith(".png")) {
    return "image/png";
  } else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
    return "image/jpeg";
  } else if (filePath.endsWith(".ico")) {
    return "image/x-icon";
  } else {
    return "application/octet-stream";
  }
}

/**
 * Check if client files exist
 */
export function checkClientFiles(clientDistPath: string): boolean {
  return existsSync(clientDistPath);
}

/**
 * Get client dist path
 * Returns different paths depending on whether running from CLI or server
 */
export function getClientDistPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Check if we're running from dist/cli.js or dist/server/*.js
  // CLI: dist/cli.js -> path is './web'
  // Server: dist/server/*.js -> path is '../web'
  if (__dirname.endsWith("dist") || __dirname.endsWith("dist/")) {
    // Running from CLI (dist/cli.js)
    return join(__dirname, "web");
  }

  // Running from server (dist/server/*.js)
  return join(__dirname, "../web");
}
