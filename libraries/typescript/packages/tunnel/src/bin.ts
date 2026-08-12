#!/usr/bin/env node
import { runTunnelCli } from "./cli.js";

runTunnelCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
