import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the inspector package (tests/e2e/helpers -> packages/inspector) */
const inspectorRoot = path.resolve(__dirname, "../../..");
/** Conformance server root (sibling package mcp-use in monorepo) */
const conformanceRoot = path.resolve(
  inspectorRoot,
  "../mcp-use/examples/server/features/conformance"
);

export const CONFORMANCE_SERVER_PATH = path.join(
  conformanceRoot,
  "src/server.ts"
);
export const CONFORMANCE_WEATHER_WIDGET_PATH = path.join(
  conformanceRoot,
  "resources/weather-display/widget.tsx"
);
export const CONFORMANCE_RESOURCES_DIR = path.join(
  conformanceRoot,
  "resources"
);

/**
 * Read file content. Used for backup and for tests that need to inspect content.
 */
export async function readConformanceFile(
  filePath: string = CONFORMANCE_SERVER_PATH
): Promise<string> {
  return readFile(filePath, "utf-8");
}

/**
 * Write content to a conformance file. Triggers HMR when server/widget files change.
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
 * Write a file inside a widget's resource directory.
 * Creates the widget directory if it doesn't exist.
 * Triggers the file watcher to register the widget via HMR.
 */
export async function writeConformanceResourceFile(
  widgetName: string,
  fileName: string,
  content: string
): Promise<void> {
  const widgetDir = path.join(CONFORMANCE_RESOURCES_DIR, widgetName);
  await mkdir(widgetDir, { recursive: true });
  await writeFile(path.join(widgetDir, fileName), content, "utf-8");
}

/**
 * Remove a widget's resource directory (and all its contents).
 * Used for cleanup after tests that dynamically create widget files.
 */
export async function removeConformanceResourceDir(
  widgetName: string
): Promise<void> {
  const widgetDir = path.join(CONFORMANCE_RESOURCES_DIR, widgetName);
  await rm(widgetDir, { recursive: true, force: true });
}
