import { readFile, writeFile } from "node:fs/promises";
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
