import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the inspector package (tests/e2e/helpers -> packages/inspector) */
const inspectorRoot = path.resolve(__dirname, "../../..");
/** Conformance server root (mcp-use v2 example). */
const conformanceRoot = path.resolve(
  inspectorRoot,
  "../server/examples/conformance"
);

export const CONFORMANCE_SERVER_PATH = path.join(
  conformanceRoot,
  "src/index.ts"
);
export const CONFORMANCE_WEATHER_VIEW_PATH = path.join(
  conformanceRoot,
  "views/weather-display/view.tsx"
);
export const CONFORMANCE_VIEWS_DIR = path.join(conformanceRoot, "views");
export const CONFORMANCE_PUBLIC_DIR = path.join(conformanceRoot, "public");

/**
 * Read file content. Used for backup and for tests that need to inspect content.
 */
export async function readConformanceFile(
  filePath: string = CONFORMANCE_SERVER_PATH
): Promise<string> {
  return readFile(filePath, "utf-8");
}

/**
 * Write content to a conformance file. Triggers HMR when server or view files change.
 */
export async function writeConformanceFile(
  content: string,
  filePath: string = CONFORMANCE_SERVER_PATH
): Promise<void> {
  await writeFile(filePath, content, "utf-8");
}

/**
 * Backup file content. Returns the current content so it can be passed to restore.
 */
export async function backupFile(
  filePath: string = CONFORMANCE_SERVER_PATH
): Promise<string> {
  return readConformanceFile(filePath);
}

/**
 * Restore file content from a previous backup.
 */
export async function restoreFile(
  content: string,
  filePath: string = CONFORMANCE_SERVER_PATH
): Promise<void> {
  await writeConformanceFile(content, filePath);
}

/**
 * Write a file inside a view's source directory.
 * Creates the view directory if it doesn't exist.
 * Triggers the file watcher to register the view via HMR.
 */
export async function writeConformanceViewFile(
  viewName: string,
  fileName: string,
  content: string
): Promise<void> {
  const viewDir = path.join(CONFORMANCE_VIEWS_DIR, viewName);
  await mkdir(viewDir, { recursive: true });
  await writeFile(path.join(viewDir, fileName), content, "utf-8");
}

/**
 * Remove a view's source directory (and all its contents).
 * Used for cleanup after tests that dynamically create views.
 */
export async function removeConformanceViewDir(
  viewName: string
): Promise<void> {
  const viewDir = path.join(CONFORMANCE_VIEWS_DIR, viewName);
  await rm(viewDir, { recursive: true, force: true });
}

/** Write a public asset served by the v2 development server. */
export async function writeConformancePublicFile(
  fileName: string,
  content: string
): Promise<void> {
  await mkdir(CONFORMANCE_PUBLIC_DIR, { recursive: true });
  await writeFile(
    path.join(CONFORMANCE_PUBLIC_DIR, fileName),
    content,
    "utf-8"
  );
}

/** Remove a public asset created by an HMR test. */
export async function removeConformancePublicFile(
  fileName: string
): Promise<void> {
  await rm(path.join(CONFORMANCE_PUBLIC_DIR, fileName), { force: true });
}
