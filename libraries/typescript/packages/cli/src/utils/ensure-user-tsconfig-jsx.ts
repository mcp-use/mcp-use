import chalk from "chalk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Ensure the user's `tsconfig.json` has the JSX settings required for inline
 * JSX widget returns (`return <Widget ... />`) to compile and type-check.
 *
 * Sets `compilerOptions.jsx = "react-jsx"` and `jsxImportSource = "mcp-use/jsx"`
 * only if they are missing. Pre-existing values are never overwritten.
 */
export async function ensureUserTsconfigJsx(
  projectPath: string
): Promise<void> {
  const userTsconfigPath = path.join(projectPath, "tsconfig.json");
  let raw: string;
  try {
    raw = await readFile(userTsconfigPath, "utf-8");
  } catch {
    return;
  }

  const { parse, modify, applyEdits } = await import("jsonc-parser");
  const errors: Parameters<typeof parse>[1] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (!parsed || typeof parsed !== "object") return;

  const compilerOptions =
    (parsed as { compilerOptions?: Record<string, unknown> }).compilerOptions ??
    {};
  let patched = raw;
  let changed = false;
  const formatting = { insertSpaces: true, tabSize: 2 } as const;

  if (compilerOptions.jsx === undefined) {
    const edits = modify(patched, ["compilerOptions", "jsx"], "react-jsx", {
      formattingOptions: formatting,
    });
    patched = applyEdits(patched, edits);
    changed = true;
  }
  if (compilerOptions.jsxImportSource === undefined) {
    const edits = modify(
      patched,
      ["compilerOptions", "jsxImportSource"],
      "mcp-use/jsx",
      { formattingOptions: formatting }
    );
    patched = applyEdits(patched, edits);
    changed = true;
  }

  if (changed) {
    await writeFile(userTsconfigPath, patched, "utf-8");
    console.log(
      chalk.gray(
        '  Patched tsconfig.json with jsx: "react-jsx" and jsxImportSource: "mcp-use/jsx"'
      )
    );
  }
}
