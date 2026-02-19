/**
 * Auto-generates TypeScript type definitions for widget props
 * Reads widget metadata and writes .mcp-use/<widget>/types.ts
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { zodToTypeString } from "./zod-to-ts.js";
import type { WidgetMetadata } from "../types/widget.js";

const TYPES_FILENAME = "types.ts";
const MCP_USE_DIR = ".mcp-use";

/**
 * Generate widget prop type definitions from widget metadata
 * @param widgetName - The widget name (e.g., "product-search-result")
 * @param slugifiedName - URL-safe slugified widget name
 * @param metadata - The widget's metadata object
 * @param projectRoot - Project root directory (defaults to process.cwd())
 */
export async function generateWidgetTypes(
  widgetName: string,
  slugifiedName: string,
  metadata: WidgetMetadata,
  projectRoot: string = process.cwd()
): Promise<void> {
  // Skip in production
  if (process.env.NODE_ENV === "production") {
    return;
  }

  try {
    // Extract prop schema
    const propsSchema = metadata.props || metadata.inputs || metadata.schema;

    let propsType = "Record<string, unknown>";

    if (propsSchema && typeof propsSchema === "object") {
      // Check if it's a Zod schema
      if (
        "_def" in propsSchema ||
        "def" in propsSchema ||
        "parse" in propsSchema
      ) {
        propsType = zodToTypeString(propsSchema as any);
      }
    }

    const content =
      `// Auto-generated widget prop types - DO NOT EDIT MANUALLY\n` +
      `// This file is regenerated whenever the widget metadata changes\n` +
      `// Generated at: ${new Date().toISOString()}\n\n` +
      `/**\n` +
      ` * Props for the ${widgetName} widget.\n` +
      ` * Automatically inferred from widgetMetadata.props in widget.tsx\n` +
      ` */\n` +
      `export type WidgetProps = ${propsType};\n`;

    const widgetDir = join(projectRoot, MCP_USE_DIR, slugifiedName);
    const outputPath = join(widgetDir, TYPES_FILENAME);

    // Check if content changed to avoid unnecessary file writes
    let shouldWrite = true;
    try {
      const existingContent = await readFile(outputPath, "utf-8");
      // Compare content after the timestamp line (line 3)
      const existingLines = existingContent.split("\n");
      const newLines = content.split("\n");
      const existingWithoutTimestamp = existingLines
        .filter((_, i) => i !== 2)
        .join("\n");
      const newWithoutTimestamp = newLines.filter((_, i) => i !== 2).join("\n");

      if (existingWithoutTimestamp === newWithoutTimestamp) {
        shouldWrite = false;
      }
    } catch {
      // File doesn't exist, should write
      shouldWrite = true;
    }

    if (shouldWrite) {
      // Ensure widget directory exists
      await mkdir(widgetDir, { recursive: true });

      // Write the file
      await writeFile(outputPath, content, "utf-8");

      console.log(`[TypeGen] Generated ${widgetName}/types.ts`);
    }
  } catch (error) {
    // Don't crash the server if type generation fails
    console.warn(
      `[TypeGen] Failed to generate widget types for ${widgetName}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
