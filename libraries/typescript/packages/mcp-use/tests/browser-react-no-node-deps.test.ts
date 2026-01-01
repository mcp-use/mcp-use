/**
 * Test to verify that mcp-use/react and mcp-use/browser do not import Node.js dependencies
 *
 * This test checks both static analysis of built files and runtime behavior.
 * It is expected to FAIL initially, proving that Node.js dependencies are being bundled.
 */

import { execSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, "..", "dist");

// Node.js built-in modules that should NOT appear in browser/react bundles
const NODE_BUILTIN_MODULES = [
  "fs",
  "path",
  "crypto",
  "os",
  "util",
  "stream",
  "buffer",
  "events",
  "http",
  "https",
  "net",
  "tls",
  "zlib",
  "cluster",
  "worker_threads",
  "perf_hooks",
  "v8",
  "vm",
  "assert",
  "querystring",
  "readline",
  "repl",
  "string_decoder",
  "timers",
  "tty",
  "dgram",
  "dns",
  "punycode",
  "module",
  "process",
  "child_process",
  "async_hooks",
];

// Node.js-specific npm packages that should NOT appear in browser/react bundles
const NODE_NPM_PACKAGES = [
  "winston",
  "chalk",
  "cli-highlight",
  "redis",
  "@hono/node-server",
  "@redis/client",
  "posthog-node",
];

/**
 * Recursively read all JavaScript files in a directory
 */
function getAllJsFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);

  files.forEach((file) => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      getAllJsFiles(filePath, fileList);
    } else if (file.endsWith(".js") && !file.endsWith(".d.ts.map")) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Check if a file contains Node.js built-in module imports
 */
function checkForNodeBuiltins(content: string, filePath: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    // Check for require("node:...") or require("...") where ... is a built-in
    // Also check for __require (bundled require) and other patterns
    const requireNodePattern = /(?:__)?require\(["']node:([^"']+)["']\)/g;
    const requireBuiltinPattern = /(?:__)?require\(["']([^"']+)["']\)/g;
    const importNodePattern = /import\s+.*from\s+["']node:([^"']+)["']/g;
    const importBuiltinPattern = /import\s+.*from\s+["']([^"']+)["']/g;
    const dynamicImportNodePattern = /import\(["']node:([^"']+)["']\)/g;
    const dynamicImportBuiltinPattern = /import\(["']([^"']+)["']\)/g;

    // Check require("node:...") or __require("node:...")
    let match;
    while ((match = requireNodePattern.exec(line)) !== null) {
      const moduleName = match[1];
      if (NODE_BUILTIN_MODULES.includes(moduleName)) {
        violations.push(
          `Line ${index + 1}: require("node:${moduleName}") - ${filePath}`
        );
      }
    }

    // Check require("...") for built-ins (without node: prefix)
    // Skip if it's a relative path or npm package
    while ((match = requireBuiltinPattern.exec(line)) !== null) {
      const moduleName = match[1];
      // Only check if it's a built-in module (not a relative path or npm package)
      if (
        NODE_BUILTIN_MODULES.includes(moduleName) &&
        !moduleName.startsWith(".") &&
        !moduleName.includes("/")
      ) {
        violations.push(
          `Line ${index + 1}: require("${moduleName}") - ${filePath}`
        );
      }
    }

    // Check import ... from "node:..."
    while ((match = importNodePattern.exec(line)) !== null) {
      const moduleName = match[1];
      if (NODE_BUILTIN_MODULES.includes(moduleName)) {
        violations.push(
          `Line ${index + 1}: import from "node:${moduleName}" - ${filePath}`
        );
      }
    }

    // Check import ... from "..." for built-ins
    while ((match = importBuiltinPattern.exec(line)) !== null) {
      const moduleName = match[1];
      // Only check if it's a built-in module (not a relative path or npm package)
      if (
        NODE_BUILTIN_MODULES.includes(moduleName) &&
        !moduleName.startsWith(".") &&
        !moduleName.includes("/") &&
        !moduleName.startsWith("@")
      ) {
        violations.push(
          `Line ${index + 1}: import from "${moduleName}" - ${filePath}`
        );
      }
    }

    // Check dynamic import("node:...")
    while ((match = dynamicImportNodePattern.exec(line)) !== null) {
      const moduleName = match[1];
      if (NODE_BUILTIN_MODULES.includes(moduleName)) {
        violations.push(
          `Line ${index + 1}: import("node:${moduleName}") - ${filePath}`
        );
      }
    }

    // Check dynamic import("...") for built-ins
    while ((match = dynamicImportBuiltinPattern.exec(line)) !== null) {
      const moduleName = match[1];
      // Only check if it's a built-in module (not a relative path or npm package)
      if (
        NODE_BUILTIN_MODULES.includes(moduleName) &&
        !moduleName.startsWith(".") &&
        !moduleName.includes("/") &&
        !moduleName.startsWith("@")
      ) {
        violations.push(
          `Line ${index + 1}: import("${moduleName}") - ${filePath}`
        );
      }
    }
  });

  return violations;
}

/**
 * Check if a file contains Node.js-specific npm package imports
 */
function checkForNodePackages(content: string, filePath: string): string[] {
  const violations: string[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    // Check for require("package") or import ... from "package"
    // Also check for __require (bundled require)
    const requirePattern = /(?:__)?require\(["']([^"']+)["']\)/g;
    const importPattern = /import\s+.*from\s+["']([^"']+)["']/g;
    const dynamicImportPattern = /import\(["']([^"']+)["']\)/g;

    let match;

    // Check require("package") or __require("package")
    while ((match = requirePattern.exec(line)) !== null) {
      const packageName = match[1];
      // Check exact match or if package name starts with the package
      if (
        NODE_NPM_PACKAGES.includes(packageName) ||
        NODE_NPM_PACKAGES.some((pkg) => packageName.startsWith(pkg + "/"))
      ) {
        violations.push(
          `Line ${index + 1}: require("${packageName}") - ${filePath}`
        );
      }
    }

    // Check import ... from "package"
    while ((match = importPattern.exec(line)) !== null) {
      const packageName = match[1];
      // Check exact match or if package name starts with the package
      if (
        NODE_NPM_PACKAGES.includes(packageName) ||
        NODE_NPM_PACKAGES.some((pkg) => packageName.startsWith(pkg + "/"))
      ) {
        violations.push(
          `Line ${index + 1}: import from "${packageName}" - ${filePath}`
        );
      }
    }

    // Check dynamic import("package")
    while ((match = dynamicImportPattern.exec(line)) !== null) {
      const packageName = match[1];
      // Check exact match or if package name starts with the package
      if (
        NODE_NPM_PACKAGES.includes(packageName) ||
        NODE_NPM_PACKAGES.some((pkg) => packageName.startsWith(pkg + "/"))
      ) {
        violations.push(
          `Line ${index + 1}: import("${packageName}") - ${filePath}`
        );
      }
    }
  });

  return violations;
}

/**
 * Get all files that are imported/required by a given entry point
 */
function getDependencyFiles(
  entryFile: string,
  visited: Set<string> = new Set()
): string[] {
  // Prevent infinite loops
  const fileKey = entryFile;
  if (visited.has(fileKey)) {
    return [];
  }
  visited.add(fileKey);

  const files: string[] = [entryFile];
  const content = readFileSync(entryFile, "utf-8");
  // Match: import ... from "..." or import "..." (side-effect imports)
  const importPattern =
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?["']([^"']+)["']/g;
  const requirePattern = /(?:__)?require\(["']([^"']+)["']\)/g;

  const imports: string[] = [];
  let match;

  while ((match = importPattern.exec(content)) !== null) {
    imports.push(match[1]);
  }

  while ((match = requirePattern.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Resolve relative imports
  imports.forEach((imp) => {
    // Skip node: imports and npm packages (we'll catch them in the check functions)
    if (
      imp.startsWith("node:") ||
      (!imp.startsWith(".") && !imp.startsWith("../"))
    ) {
      return;
    }

    if (imp.startsWith(".") || imp.startsWith("../")) {
      const resolvedPath = join(dirname(entryFile), imp);
      // Normalize the path to handle ../ correctly
      const normalizedPath = join(resolvedPath); // join() normalizes the path
      // Try with .js extension if not already present
      let jsPath = normalizedPath;
      if (!jsPath.endsWith(".js") && !jsPath.endsWith(".cjs")) {
        jsPath = `${normalizedPath}.js`;
      }
      try {
        const stats = statSync(jsPath);
        if (stats.isFile()) {
          files.push(jsPath);
          // Recursively get dependencies
          files.push(...getDependencyFiles(jsPath, visited));
        }
      } catch (error) {
        // File doesn't exist, skip
        // Try without extension if it had one
        if (jsPath.endsWith(".js")) {
          try {
            const statsNoExt = statSync(normalizedPath);
            if (statsNoExt.isFile()) {
              files.push(normalizedPath);
              files.push(...getDependencyFiles(normalizedPath, visited));
            }
          } catch {
            // Still doesn't exist, skip
          }
        }
      }
    }
  });

  return [...new Set(files)]; // Remove duplicates
}

describe("Browser/React exports should not import Node.js dependencies", () => {
  describe("mcp-use/react", () => {
    const reactEntryFile = join(distDir, "src", "react", "index.js");

    it("should not import Node.js built-in modules in built output", () => {
      if (!statSync(reactEntryFile, { throwIfNoEntry: false })) {
        throw new Error(
          `Built file not found: ${reactEntryFile}. Please run 'npm run build' first.`
        );
      }

      const dependencyFiles = getDependencyFiles(reactEntryFile);
      const allViolations: string[] = [];

      dependencyFiles.forEach((file) => {
        try {
          const content = readFileSync(file, "utf-8");
          const violations = checkForNodeBuiltins(content, file);
          allViolations.push(...violations);
        } catch (error) {
          // File might not exist or be readable, skip
          console.debug(`Skipped file ${file}: ${error}`);
        }
      });

      if (allViolations.length > 0) {
        console.error(
          "\n❌ Found Node.js built-in module imports in mcp-use/react:\n"
        );
        allViolations.forEach((violation) => {
          console.error(`  - ${violation}`);
        });
      }

      expect(allViolations).toEqual([]);
    });

    it("should not import Node.js-specific npm packages in built output", () => {
      if (!statSync(reactEntryFile, { throwIfNoEntry: false })) {
        throw new Error(
          `Built file not found: ${reactEntryFile}. Please run 'npm run build' first.`
        );
      }

      const dependencyFiles = getDependencyFiles(reactEntryFile);
      const allViolations: string[] = [];

      dependencyFiles.forEach((file) => {
        try {
          const content = readFileSync(file, "utf-8");
          const violations = checkForNodePackages(content, file);
          allViolations.push(...violations);
        } catch (error) {
          // File might not exist or be readable, skip
          console.debug(`Skipped file ${file}: ${error}`);
        }
      });

      if (allViolations.length > 0) {
        console.error(
          "\n❌ Found Node.js-specific npm packages in mcp-use/react:\n"
        );
        allViolations.forEach((violation) => {
          console.error(`  - ${violation}`);
        });
      }

      expect(allViolations).toEqual([]);
    });

    // Run in subprocess to avoid vitest's module caching issues
    // NOTE: This test uses minimal global mocks that may not accurately reflect
    // real browser behavior. Code that depends on deeper browser API functionality
    // may pass these tests but fail in actual browsers. Consider using a real
    // browser environment (Playwright/Puppeteer) or jsdom for more accurate testing.
    it("should import and execute code successfully in browser-like environment", () => {
      const modulePath = join(distDir, "src", "react", "index.js").replace(
        /\\/g,
        "/"
      );

      // Script that simulates browser environment and imports the module
      const testScript = `
globalThis.process = { env: { NODE_ENV: 'production' } };
globalThis.window = { location: { origin: 'http://localhost:3000' }, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = {};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
import('${modulePath}')
  .then(m => {
    if (!m.useMcp) throw new Error('useMcp not exported');
    if (typeof m.useMcp !== 'function') throw new Error('useMcp is not a function');
    if (!m.Tel) throw new Error('Tel not exported');
    const tel = m.Tel.getInstance();
    if (!tel) throw new Error('Tel.getInstance() returned falsy');
    m.setTelemetrySource('test-source');
    console.log('__TEST_SUCCESS__');
  })
  .catch(e => { console.error('FAIL:', e.message); process.exit(1); });
`;

      // Write script to temp file to avoid shell escaping issues
      const tmpFile = join(__dirname, "..", ".test-react-runtime.mjs");
      writeFileSync(tmpFile, testScript);

      try {
        const result = execSync(`node ${tmpFile}`, {
          encoding: "utf-8",
          timeout: 10000,
        });
        expect(result).toContain("__TEST_SUCCESS__");
      } catch (error: any) {
        const stderr = error.stderr?.toString() || "";
        const stdout = error.stdout?.toString() || "";
        throw new Error(
          `Failed to import/execute mcp-use/react in browser-like environment:\n${stderr || stdout || error.message}`
        );
      } finally {
        // Clean up temp file
        try {
          unlinkSync(tmpFile);
        } catch (error) {
          // File might already be deleted or permissions issue - log but don't fail test
          console.debug(`Failed to cleanup temp file: ${error}`);
        }
      }
    });
  });

  describe("mcp-use/browser", () => {
    const browserEntryFile = join(distDir, "src", "browser.js");

    it("should not import Node.js built-in modules in built output", () => {
      if (!statSync(browserEntryFile, { throwIfNoEntry: false })) {
        throw new Error(
          `Built file not found: ${browserEntryFile}. Please run 'npm run build' first.`
        );
      }

      const dependencyFiles = getDependencyFiles(browserEntryFile);
      const allViolations: string[] = [];

      dependencyFiles.forEach((file) => {
        try {
          const content = readFileSync(file, "utf-8");
          const violations = checkForNodeBuiltins(content, file);
          allViolations.push(...violations);
        } catch (error) {
          // File might not exist or be readable, skip
          console.debug(`Skipped file ${file}: ${error}`);
        }
      });

      if (allViolations.length > 0) {
        console.error(
          "\n❌ Found Node.js built-in module imports in mcp-use/browser:\n"
        );
        allViolations.forEach((violation) => {
          console.error(`  - ${violation}`);
        });
      }

      expect(allViolations).toEqual([]);
    });

    it("should not import Node.js-specific npm packages in built output", () => {
      if (!statSync(browserEntryFile, { throwIfNoEntry: false })) {
        throw new Error(
          `Built file not found: ${browserEntryFile}. Please run 'npm run build' first.`
        );
      }

      const dependencyFiles = getDependencyFiles(browserEntryFile);
      const allViolations: string[] = [];

      dependencyFiles.forEach((file) => {
        try {
          const content = readFileSync(file, "utf-8");
          const violations = checkForNodePackages(content, file);
          allViolations.push(...violations);
        } catch (error) {
          // File might not exist or be readable, skip
          console.debug(`Skipped file ${file}: ${error}`);
        }
      });

      if (allViolations.length > 0) {
        console.error(
          "\n❌ Found Node.js-specific npm packages in mcp-use/browser:\n"
        );
        allViolations.forEach((violation) => {
          console.error(`  - ${violation}`);
        });
      }

      expect(allViolations).toEqual([]);
    });

    // Run in subprocess to avoid vitest's module caching issues
    // NOTE: This test uses minimal global mocks that may not accurately reflect
    // real browser behavior. Code that depends on deeper browser API functionality
    // may pass these tests but fail in actual browsers. Consider using a real
    // browser environment (Playwright/Puppeteer) or jsdom for more accurate testing.
    it("should import and execute code successfully in browser-like environment", () => {
      const modulePath = join(distDir, "src", "browser.js").replace(/\\/g, "/");

      // Script that simulates browser environment and imports the module
      const testScript = `
globalThis.process = { env: { NODE_ENV: 'production' } };
globalThis.window = { location: { origin: 'http://localhost:3000' }, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.document = {};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
import('${modulePath}')
  .then(m => {
    if (!m.MCPClient) throw new Error('MCPClient not exported');
    if (typeof m.MCPClient !== 'function') throw new Error('MCPClient is not a function');
    if (!m.Tel) throw new Error('Tel not exported');
    const tel = m.Tel.getInstance();
    if (!tel) throw new Error('Tel.getInstance() returned falsy');
    if (!m.logger) throw new Error('logger not exported');
    m.logger.info('Test log');
    const version = m.getPackageVersion();
    if (typeof version !== 'string') throw new Error('getPackageVersion did not return string');
    console.log('__TEST_SUCCESS__');
  })
  .catch(e => { console.error('FAIL:', e.message); process.exit(1); });
`;

      // Write script to temp file to avoid shell escaping issues
      const tmpFile = join(__dirname, "..", ".test-browser-runtime.mjs");
      writeFileSync(tmpFile, testScript);

      try {
        const result = execSync(`node ${tmpFile}`, {
          encoding: "utf-8",
          timeout: 10000,
        });
        expect(result).toContain("__TEST_SUCCESS__");
      } catch (error: any) {
        const stderr = error.stderr?.toString() || "";
        const stdout = error.stdout?.toString() || "";
        throw new Error(
          `Failed to import/execute mcp-use/browser in browser-like environment:\n${stderr || stdout || error.message}`
        );
      } finally {
        // Clean up temp file
        try {
          unlinkSync(tmpFile);
        } catch (error) {
          // File might already be deleted or permissions issue - log but don't fail test
          console.debug(`Failed to cleanup temp file: ${error}`);
        }
      }
    });
  });
});
