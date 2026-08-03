#!/usr/bin/env node
import { main } from "./index.js";

declare const __MCP_USE_CLI_VERSION__: string;

main(process.argv.slice(2), {
  frameworkVersion: __MCP_USE_CLI_VERSION__,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
);
