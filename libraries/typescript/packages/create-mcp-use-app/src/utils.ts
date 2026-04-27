// Utility functions for create-mcp-use-app
// Extracted to allow testing without heavy UI/CLI dependencies

// Known safe entries that may exist in a directory without considering it "non-empty"
// Mirrors create-next-app behavior for common init artifacts
export const SAFE_DIR_ENTRIES = new Set([
  ".git",
  ".gitignore",
  ".DS_Store",
  ".idea",
  ".vscode",
  "LICENSE",
  "Thumbs.db",
]);

export function isSafeEntry(name: string): boolean {
  if (SAFE_DIR_ENTRIES.has(name)) return true;
  // README with any extension (README, README.md, README.txt, etc.)
  if (/^README(\.[a-z]+)?$/i.test(name)) return true;
  return false;
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
