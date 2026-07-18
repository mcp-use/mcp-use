/**
 * Root-level MCP env declaration shared by `mcp-use dev` and `mcp-use build`.
 *
 * Combines CSS module typing and a live type-only edge to the server entry so
 * exported `ToolRef`s update in TypeScript without rerunning the CLI.
 */

import { writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

/** Filename of the project-owned MCP env declaration. */
export const MCP_ENV_DECLARATION_NAME = "mcp-env.d.ts";

function declarationImportPath(cwd: string, entry: string): string {
  let importPath = relative(cwd, entry).split(sep).join("/");
  const extension = extname(importPath);
  const runtimeExtension =
    extension === ".mts"
      ? ".mjs"
      : extension === ".cts"
        ? ".cjs"
        : extension === ".ts" || extension === ".tsx"
          ? ".js"
          : extension;

  if (extension !== runtimeExtension) {
    importPath = `${importPath.slice(0, -extension.length)}${runtimeExtension}`;
  }
  return importPath.startsWith(".") ? importPath : `./${importPath}`;
}

/** Build the stable declaration contents for a discovered server entry. */
export function renderMcpEnvDeclaration(cwd: string, entry: string): string {
  const importPath = declarationImportPath(cwd, entry);
  return [
    "// mcp-use generated env declaration",
    'declare module "*.css";',
    "",
    'declare module "mcp-use/react" {',
    "  interface Register {",
    `    tools: typeof import(${JSON.stringify(importPath)});`,
    "  }",
    "}",
    "",
    "export {};",
    "",
  ].join("\n");
}

/**
 * Create the root `mcp-env.d.ts` if absent.
 *
 * Exclusive-create mode makes this safe when dev and build start together and
 * guarantees that a user-authored declaration is never truncated or replaced.
 *
 * @returns `true` when this invocation created the file.
 */
export async function ensureMcpEnvDeclaration(
  cwd: string,
  entry: string
): Promise<boolean> {
  const declarationPath = join(cwd, MCP_ENV_DECLARATION_NAME);
  try {
    await writeFile(declarationPath, renderMcpEnvDeclaration(cwd, entry), {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return false;
    }
    throw error;
  }
}
