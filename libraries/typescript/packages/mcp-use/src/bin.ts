#!/usr/bin/env node

// The framework package owns the user-facing `mcp-use` executable. The command
// implementation lives in @mcp-use/cli for the transitional V2 package split,
// but it is installed as an implementation dependency of mcp-use.

void import(
  // @ts-expect-error optional peer dependency — may not be installed
  "@mcp-use/cli/dist/index.js"
).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof Error && "code" in err
      ? (err as NodeJS.ErrnoException).code
      : undefined;
  const missingCli =
    code === "ERR_MODULE_NOT_FOUND" ||
    message.includes("Cannot find package '@mcp-use/cli'") ||
    message.includes("Cannot find module '@mcp-use/cli'");

  if (missingCli) {
    console.error(
      "The bundled mcp-use CLI implementation could not be loaded.\n\n" +
        "Reinstall mcp-use to restore the framework CLI:\n" +
        "  npm i mcp-use"
    );
    process.exit(1);
  }

  throw err;
});
