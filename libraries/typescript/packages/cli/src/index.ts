#!/usr/bin/env node
try {
  const frameworkEntry = new URL(import.meta.resolve("mcp-use"));
  await import(new URL("./bin.js", frameworkEntry).href);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
