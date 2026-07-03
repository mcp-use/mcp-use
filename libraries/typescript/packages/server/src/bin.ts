#!/usr/bin/env node
/*
 * `mcp-use` bin entry point (specs/CLI_SPEC.md).
 *
 * Kept to a single call so all logic lives in testable modules under
 * src/bin/. On success the process is NOT exited: `start` (and `dev`) keep
 * serving, and `--help`/`--version` let the event loop drain naturally.
 */
import { main } from "./bin/main.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
);
