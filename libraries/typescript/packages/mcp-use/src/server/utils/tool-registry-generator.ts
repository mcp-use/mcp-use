/**
 * Auto-generates TypeScript type definitions for the ToolRegistry
 * Reads tool schemas from MCPServer registrations and writes .mcp-use/tool-registry.d.ts
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { zodToTypeString } from "./zod-to-ts.js";
import type { ToolDefinition } from "../types/tool.js";
import type { ToolCallback } from "../types/tool.js";

const TOOL_REGISTRY_FILENAME = "tool-registry.d.ts";
const MCP_USE_DIR = ".mcp-use";

/**
 * Generate tool registry type definitions from registered tools
 * @param registrations - The server's registrations.tools Map
 * @param projectRoot - Project root directory (defaults to process.cwd())
 */
export async function generateToolRegistryTypes(
  registrations: Map<string, { config: ToolDefinition; handler: ToolCallback }>,
  projectRoot: string = process.cwd()
): Promise<void> {
  // Skip in production
  if (process.env.NODE_ENV === "production") {
    return;
  }

  try {
    const toolEntries: string[] = [];

    // Sort tool names for deterministic output
    const sortedTools = Array.from(registrations.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    for (const [toolName, { config }] of sortedTools) {
      const inputType = config.schema ? zodToTypeString(config.schema) : "null";

      const outputType = config.outputSchema
        ? zodToTypeString(config.outputSchema)
        : "Record<string, unknown>";

      toolEntries.push(
        `    ${JSON.stringify(toolName)}: {\n` +
          `      input: ${inputType};\n` +
          `      output: ${outputType};\n` +
          `    };`
      );
    }

    const content =
      `// Auto-generated tool registry types - DO NOT EDIT MANUALLY\n` +
      `// This file is regenerated whenever tools are added, removed, or updated during development\n` +
      `// Generated at: ${new Date().toISOString()}\n\n` +
      `declare module "mcp-use/react" {\n` +
      `  interface ToolRegistry {\n` +
      (toolEntries.length > 0
        ? toolEntries.join("\n") + "\n"
        : "    // No tools registered yet\n") +
      `  }\n` +
      `}\n` +
      `\n` +
      `export {};\n`;

    const mcpUseDir = join(projectRoot, MCP_USE_DIR);
    const outputPath = join(mcpUseDir, TOOL_REGISTRY_FILENAME);

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
      // Ensure .mcp-use directory exists
      await mkdir(mcpUseDir, { recursive: true });

      // Write the file
      await writeFile(outputPath, content, "utf-8");

      console.log(
        `[TypeGen] Generated ${TOOL_REGISTRY_FILENAME} with ${sortedTools.length} tool(s)`
      );
    }
  } catch (error) {
    // Don't crash the server if type generation fails
    console.warn(
      "[TypeGen] Failed to generate tool registry types:",
      error instanceof Error ? error.message : String(error)
    );
  }
}
