// Utility functions for create-mcp-use-app
// Extracted to allow testing without heavy UI/CLI dependencies (index.tsx
// runs commander on import, so its inner functions can't be imported in tests).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Known safe entries that may exist in a directory without considering it "non-empty"
// Mirrors create-next-app behavior for common init artifacts
export const SAFE_DIR_ENTRIES = new Set([
  ".claude",
  ".cursor",
  ".DS_Store",
  ".git",
  ".gitattributes",
  ".gitignore",
  ".gitlab-ci.yml",
  ".hg",
  ".hgcheck",
  ".hgignore",
  ".idea",
  ".npmignore",
  ".travis.yml",
  ".vscode",
  ".zed",
  "LICENSE",
  "Thumbs.db",
  "docs",
  "mkdocs.yml",
  "npm-debug.log",
  "yarn-debug.log",
  "yarn-error.log",
  "yarnrc.yml",
  ".yarn",
]);

export function isSafeEntry(name: string): boolean {
  return SAFE_DIR_ENTRIES.has(name);
}

// Returns the entries in `dir` that would clash with the template, sorted.
// An empty result means it's safe to scaffold into `dir`.
export function findUnsafeEntries(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => !isSafeEntry(entry))
    .sort();
}

// Sanitize a raw directory name into a valid npm package name.
// npm names must be lowercase and may not contain spaces, most special chars,
// or leading dots/dashes.
export function sanitizePackageName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "-")
      .replace(/^[.-]+/, "")
      .replace(/[.-]+$/, "") || "my-app"
  );
}

// Resolves what to scaffold given a raw user-supplied name.
// `displayName` is the human-facing label (kept pretty when possible);
// `packageName` is the npm-safe identifier flowed into package.json AND
// any template files that embed it as a string literal (e.g. index.ts).
export type ProjectInfo = {
  useCurrentDir: boolean;
  projectPath: string;
  displayName: string;
  packageName: string;
};

export function deriveProjectInfo(rawName: string, cwd: string): ProjectInfo {
  const name = rawName.trim();
  if (name === ".") {
    const displayName = basename(cwd);
    return {
      useCurrentDir: true,
      projectPath: cwd,
      displayName,
      packageName: sanitizePackageName(displayName),
    };
  }
  return {
    useCurrentDir: false,
    projectPath: resolve(cwd, name),
    displayName: name,
    packageName: name,
  };
}

export function updatePackageJson(projectPath: string, projectName: string) {
  const packageJsonPath = join(projectPath, "package.json");
  const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

  packageJsonContent.name = projectName;
  packageJsonContent.description = `MCP server: ${projectName}`;

  writeFileSync(packageJsonPath, JSON.stringify(packageJsonContent, null, 2));
}

export function updateIndexTs(projectPath: string, projectName: string) {
  const indexPath = join(projectPath, "index.ts");

  if (!existsSync(indexPath)) {
    return;
  }

  let content = readFileSync(indexPath, "utf-8");
  content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
  writeFileSync(indexPath, content);
}
