// Utility functions for create-mcp-use-app
// Extracted to allow testing without heavy UI/CLI dependencies

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

// Sanitize a raw directory name into a valid npm package name
export function sanitizePackageName(raw: string): string {
  return (
    raw
      .toLowerCase()
      // Replace any character that isn't [a-z0-9_.-] with a hyphen
      .replace(/[^a-z0-9_.-]/g, "-")
      // Trim leading dots and dashes (npm disallows them)
      .replace(/^[.-]+/, "")
      // Trim trailing dots and dashes for cleanliness
      .replace(/[.-]+$/, "") || "my-app"
  ); // fallback if everything was stripped
}
