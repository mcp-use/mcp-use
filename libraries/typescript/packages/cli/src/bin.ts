#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { main } from "./index.js";

declare const __MCP_USE_CLI_VERSION__: string;

function installedFrameworkVersion(): string | undefined {
  try {
    const entry = createRequire(import.meta.url).resolve("mcp-use");
    let directory = dirname(entry);
    const root = parse(directory).root;
    while (directory !== root) {
      try {
        const manifest = JSON.parse(
          readFileSync(join(directory, "package.json"), "utf8")
        ) as { name?: unknown; version?: unknown };
        if (
          manifest.name === "mcp-use" &&
          typeof manifest.version === "string"
        ) {
          return manifest.version;
        }
      } catch {
        // Continue upward until the resolved package root is found.
      }
      directory = dirname(directory);
    }
  } catch {
    // The standalone CLI intentionally works without the framework installed.
  }
  return undefined;
}

main(process.argv.slice(2), {
  frameworkVersion: installedFrameworkVersion() ?? __MCP_USE_CLI_VERSION__,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
);
