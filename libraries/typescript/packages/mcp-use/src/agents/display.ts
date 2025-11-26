import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import chalk from "chalk";
import { highlight } from "cli-highlight";
import stripAnsiLib from "strip-ansi";

/**
 * Helper functions for pretty-printing code mode tool executions
 */

const TERMINAL_WIDTH = process.stdout.columns || 120;

interface ExecuteCodeResult {
  result: unknown;
  logs: string[];
  error: string | null;
  execution_time: number;
}

// Remove ANSI color codes for length calculation using the strip-ansi library
function stripAnsi(str: string): string {
  return stripAnsiLib(str);
}

// wrap lines correctly, preserving ANSI codes
function wrapAnsiLine(line: string, maxWidth: number): string[] {
  const stripped = stripAnsi(line);

  if (stripped.length <= maxWidth) return [line];

  const result: string[] = [];
  let visibleCount = 0;
  let current = "";
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === "\x1b") {
      // Start of escape sequence
      let sequence = char;
      i++;
      while (i < line.length) {
        const nextChar = line[i];
        sequence += nextChar;
        i++;
        if (nextChar === "m") break;
      }
      current += sequence;
      continue;
    }

    // Normal character
    current += char;
    visibleCount++;
    i++;

    if (visibleCount >= maxWidth) {
      result.push(current);
      current = "";
      visibleCount = 0;
    }
  }
  if (current) result.push(current);
  return result;
}

export function printBox(
  content: string,
  title?: string,
  language?: string,
  bgColor = false
) {
  const width = TERMINAL_WIDTH;

  let displayContent = content;
  if (language) {
    try {
      displayContent = highlight(content, { language, ignoreIllegals: true });
    } catch {
      // Highlighting failed, use plain content
    }
  }

  const lines = displayContent
    .split("\n")
    .flatMap((line) => wrapAnsiLine(line, width - 4));

  console.log(chalk.gray("┌" + "─".repeat(width - 2) + "┐"));

  if (title) {
    const stripped = stripAnsi(title);
    const lineText = `${title} `;
    const padding = Math.max(0, width - 4 - stripped.length - 2);
    console.log(
      chalk.gray("│ ") +
        chalk.bold.white(lineText) +
        " ".repeat(padding) +
        chalk.gray(" │")
    );
    console.log(chalk.gray("├" + "─".repeat(width - 2) + "┤"));
  }

  lines.forEach((line) => {
    const stripped = stripAnsi(line);
    const padding = Math.max(0, width - 4 - stripped.length);
    const finalLine = bgColor
      ? chalk.bgGray(line + " ".repeat(padding))
      : line + " ".repeat(padding);

    console.log(chalk.gray("│ ") + finalLine + chalk.gray(" │"));
  });

  console.log(chalk.gray("└" + "─".repeat(width - 2) + "┘"));
}

/**
 * Extract code from tool input if present
 */
export function extractCodeFromToolInput(input: unknown): string | null {
  if (typeof input === "object" && input !== null && "code" in input) {
    const inputObj = input as Record<string, unknown>;
    return typeof inputObj.code === "string" ? inputObj.code : null;
  }
  return null;
}

/**
 * Type guard to check if an object is an ExecuteCodeResult
 */
function isExecuteCodeResult(obj: unknown): obj is ExecuteCodeResult {
  if (typeof obj !== "object" || obj === null) return false;
  const result = obj as Record<string, unknown>;
  return (
    "result" in result &&
    "logs" in result &&
    Array.isArray(result.logs) &&
    "execution_time" in result &&
    typeof result.execution_time === "number" &&
    "error" in result &&
    (typeof result.error === "string" || result.error === null)
  );
}

/**
 * Parse execute_code tool result
 */
export function parseExecuteCodeResult(
  output: unknown
): ExecuteCodeResult | null {
  try {
    // If output is a string, try to parse it as JSON
    if (typeof output === "string") {
      const parsed = JSON.parse(output);
      if (isExecuteCodeResult(parsed)) {
        return parsed;
      }
    }
    // If output is already an object with the right structure
    if (isExecuteCodeResult(output)) {
      return output;
    }
  } catch (e) {
    // Not a valid execute_code result
  }
  return null;
}

/**
 * Render content with appropriate formatting
 */
export function renderContent(content: unknown): string {
  if (content === null || content === undefined) {
    return "null";
  }

  if (typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }

  return String(content);
}

/**
 * Unwrap tool input if it's wrapped in an "input" field with JSON string
 */
export function unwrapToolInput(input: unknown): unknown {
  // Check if input has an "input" field that's a JSON string
  if (typeof input === "object" && input !== null && "input" in input) {
    const inputObj = input as Record<string, unknown>;
    if (typeof inputObj.input === "string") {
      try {
        // Try to parse the JSON string
        return JSON.parse(inputObj.input);
      } catch (e) {
        // If parsing fails, return the original input field
        return inputObj.input;
      }
    }
  }
  return input;
}

/**
 * Handle tool start event with pretty printing
 */
export function handleToolStart(event: StreamEvent) {
  const toolName = event.name || "unknown";
  let input = event.data?.input || {};

  // Unwrap input if it's wrapped in a JSON string
  input = unwrapToolInput(input);

  // Special handling for execute_code to show the code nicely
  const code = extractCodeFromToolInput(input);
  if (code) {
    printBox(code, `${toolName} - input`, "javascript", false);

    // Show other parameters if any
    const otherParams = { ...input };
    delete otherParams.code;
    if (Object.keys(otherParams).length > 0) {
      printBox(renderContent(otherParams), "Other Parameters", "json", false);
    }
  } else {
    printBox(renderContent(input), `${toolName} - input`, "json", false);
  }
}

/**
 * Extract content from LangChain ToolMessage structure
 */
export function extractToolMessageContent(
  output: unknown
): { toolName: string; status: string; content: unknown } | null {
  try {
    // Check if this is a LangChain ToolMessage object (has name and content properties)
    if (
      typeof output === "object" &&
      output !== null &&
      "name" in output &&
      "content" in output
    ) {
      const outputObj = output as Record<string, unknown>;
      const toolName =
        (typeof outputObj.name === "string" ? outputObj.name : null) ||
        "unknown";
      // LangChain messages might have status in lc_kwargs or in the content itself
      const lcKwargs = outputObj.lc_kwargs as
        | Record<string, unknown>
        | undefined;
      const status =
        (lcKwargs?.status as string) ||
        (outputObj.status as string) ||
        "unknown";
      let content = outputObj.content;

      // Try to parse content if it's a JSON string
      if (typeof content === "string") {
        try {
          content = JSON.parse(content);
        } catch (e) {
          // Keep as string if not JSON
        }
      }

      return { toolName, status, content };
    }
  } catch (e) {
    // Not a valid ToolMessage structure
  }
  return null;
}

/**
 * Format search_tools result as a tree structure
 */
export function formatSearchToolsAsTree(
  tools: Array<{ server: string; name: string; description?: string }>,
  meta?: { total_tools?: number; namespaces?: string[]; result_count?: number },
  query?: string
): string {
  // Build meta information display
  const metaLines: string[] = [];
  if (meta) {
    if (meta.total_tools !== undefined) {
      metaLines.push(`Total tools: ${meta.total_tools}`);
    }
    if (meta.namespaces && meta.namespaces.length > 0) {
      metaLines.push(`Namespaces: ${meta.namespaces.join(", ")}`);
    }
    if (meta.result_count !== undefined) {
      metaLines.push(`Results: ${meta.result_count}`);
    }
  }

  if (!Array.isArray(tools) || tools.length === 0) {
    const noResultsMsg = query
      ? `No tools found for query "${query}"`
      : "(no tools found)";
    if (metaLines.length > 0) {
      return `${metaLines.join("\n")}\n\n${noResultsMsg}`;
    }
    return noResultsMsg;
  }

  // Group tools by server
  const toolsByServer: Record<
    string,
    Array<{ name: string; description?: string }>
  > = {};
  for (const tool of tools) {
    const server = tool.server || "unknown";
    if (!toolsByServer[server]) {
      toolsByServer[server] = [];
    }
    toolsByServer[server].push(tool);
  }

  // Build tree structure
  const lines: string[] = [];

  // Add meta information at the top if available
  if (meta) {
    if (meta.total_tools !== undefined) {
      lines.push(`Total tools: ${meta.total_tools}`);
    }
    if (meta.namespaces && meta.namespaces.length > 0) {
      lines.push(`Namespaces: ${meta.namespaces.join(", ")}`);
    }
    if (meta.result_count !== undefined) {
      lines.push(`Results: ${meta.result_count}`);
    }
    if (lines.length > 0) {
      lines.push(""); // Empty line before tree
    }
  }

  const servers = Object.keys(toolsByServer).sort();

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const serverTools = toolsByServer[server];
    const isLastServer = i === servers.length - 1;
    const serverPrefix = isLastServer ? "└─" : "├─";

    lines.push(
      `${serverPrefix} ${chalk.cyan(server)} (${serverTools.length} tools)`
    );

    // Add tools under this server
    for (let j = 0; j < serverTools.length; j++) {
      const tool = serverTools[j];
      const isLastTool = j === serverTools.length - 1;
      const indent = isLastServer ? "  " : "│ ";
      const toolPrefix = isLastTool ? "└─" : "├─";

      // Tool name line
      const toolLine = `${indent}${toolPrefix} ${tool.name}`;
      lines.push(toolLine);

      // Description on new line, aligned with tool name
      if (tool.description) {
        // Calculate indent for description lines
        // Use the same base indent as the tool, then add alignment
        // If not the last tool, add vertical bar to show continuation, otherwise spaces
        const descAlign = isLastTool ? "   " : "│  ";
        const descriptionIndent = `${indent}${descAlign}`;

        // Calculate available width for description
        // Account for: indent + box padding (4 chars for "│ " on each side)
        const indentLength = stripAnsi(descriptionIndent).length;
        const availableWidth = Math.max(40, TERMINAL_WIDTH - indentLength - 4);

        // Wrap description at word boundaries
        const words = tool.description.split(/(\s+)/); // Keep whitespace
        const wrappedLines: string[] = [];
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine + word;
          if (stripAnsi(testLine).length <= availableWidth) {
            currentLine = testLine;
          } else {
            if (currentLine) {
              wrappedLines.push(currentLine.trimEnd());
            }
            currentLine = word.trimStart();
          }
        }
        if (currentLine) {
          wrappedLines.push(currentLine.trimEnd());
        }

        // Add indent and dim styling to each line
        for (const descLine of wrappedLines) {
          lines.push(`${descriptionIndent}${chalk.dim(descLine)}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Handle tool end event with pretty printing
 */
export function handleToolEnd(event: StreamEvent) {
  const output = event.data?.output;

  // First, try to extract from LangChain ToolMessage structure if present
  const toolMessage = extractToolMessageContent(output);
  if (toolMessage) {
    const { toolName, status, content } = toolMessage;

    // For execute_code, extract the actual result from the nested structure
    if (toolName === "execute_code") {
      // Content might be wrapped in { content: [{ type: "text", text: "..." }] }
      let actualContent = content;
      if (
        typeof content === "object" &&
        content !== null &&
        "content" in content
      ) {
        const innerContent = content.content;
        if (Array.isArray(innerContent) && innerContent.length > 0) {
          if (innerContent[0].type === "text" && innerContent[0].text) {
            actualContent = innerContent[0].text;
          }
        }
      }

      // Now try to parse as execute_code result
      const execResult = parseExecuteCodeResult(actualContent);
      if (execResult) {
        // Format execution time in milliseconds
        const timeMs = execResult.execution_time
          ? Math.round(execResult.execution_time * 1000)
          : 0;
        const timeStr = `${timeMs}ms`;

        // Determine status text
        const isError =
          execResult.error !== null &&
          execResult.error !== undefined &&
          execResult.error !== "";
        const statusText = isError
          ? chalk.red("error")
          : chalk.green("success");
        const title = `${toolName} - ${statusText} - ${timeStr}`;

        // Only show the result, not the full object
        if (execResult.result !== null && execResult.result !== undefined) {
          const resultStr = renderContent(execResult.result);
          const language =
            typeof execResult.result === "object" ? "json" : undefined;
          printBox(resultStr, title, language, false);
        } else {
          printBox("(no result)", title, undefined, false);
        }

        if (execResult.logs && execResult.logs.length > 0) {
          printBox(execResult.logs.join("\n"), `Logs`, undefined, false);
        }

        if (execResult.error) {
          printBox(execResult.error, chalk.red("Error"), undefined, false);
        }
        return;
      }
    }

    // Special handling for search_tools to display as tree
    if (toolName === "search_tools") {
      // Try to get the query from event input
      const toolInput = event.data?.input as
        | Record<string, unknown>
        | undefined;
      const query = toolInput?.query as string | undefined;

      // Extract actual content if it's wrapped
      let actualContent = content;
      if (
        typeof content === "object" &&
        content !== null &&
        !Array.isArray(content) &&
        "content" in content
      ) {
        const innerContent = content.content;
        if (Array.isArray(innerContent) && innerContent.length > 0) {
          if (innerContent[0].type === "text" && innerContent[0].text) {
            try {
              actualContent = JSON.parse(innerContent[0].text);
            } catch (e) {
              actualContent = innerContent[0].text;
            }
          }
        }
      }

      // Handle new format: object with meta and results
      if (
        typeof actualContent === "object" &&
        actualContent !== null &&
        !Array.isArray(actualContent) &&
        "results" in actualContent &&
        Array.isArray(actualContent.results)
      ) {
        const results = actualContent.results;
        const contentWithMeta = actualContent as {
          results: unknown[];
          meta?: {
            total_tools?: number;
            namespaces?: string[];
            result_count?: number;
          };
        };
        const meta = contentWithMeta.meta;
        const treeStr = formatSearchToolsAsTree(results, meta, query);
        const statusText =
          status === "success" ? chalk.green("Success") : chalk.red("Error");
        const title = `${statusText}: ${toolName} - Result`;
        printBox(treeStr, title, undefined, false);
        return;
      }

      // Handle old format: direct array (backward compatibility)
      if (Array.isArray(actualContent)) {
        const treeStr = formatSearchToolsAsTree(
          actualContent,
          undefined,
          query
        );
        const statusText =
          status === "success" ? chalk.green("Success") : chalk.red("Error");
        const title = `${statusText}: ${toolName} - Result`;
        printBox(treeStr, title, undefined, false);
        return;
      }
    }

    // Check if content indicates an error
    const contentObj =
      typeof content === "object" && content !== null
        ? (content as Record<string, unknown>)
        : null;
    const isError =
      (contentObj && "isError" in contentObj && contentObj.isError === true) ||
      status === "error";

    // Extract the actual content to display
    let displayContent = content;
    if (
      typeof content === "object" &&
      content !== null &&
      "content" in content
    ) {
      displayContent = content.content;

      // If content.content is an array with text items, extract the text
      if (Array.isArray(displayContent) && displayContent.length > 0) {
        if (displayContent[0].type === "text" && displayContent[0].text) {
          displayContent = displayContent[0].text;
        }
      }
    }

    // Format the content for display
    const contentStr = renderContent(displayContent);
    const language = typeof displayContent === "object" ? "json" : undefined;

    // Create title with tool name
    const statusLabel =
      status === "success"
        ? chalk.green("Success")
        : isError
          ? chalk.red("Error")
          : "Result";
    const title = `${statusLabel}: ${toolName} - Result`;

    printBox(contentStr, title, language, false);
    return;
  }

  // Fallback: Try to parse as direct execute_code result (not wrapped in ToolMessage)
  const execResult = parseExecuteCodeResult(output);
  if (execResult) {
    const timeMs = execResult.execution_time
      ? Math.round(execResult.execution_time * 1000)
      : 0;
    const timeStr = `${timeMs}ms`;

    if (execResult.result !== null && execResult.result !== undefined) {
      const resultStr = renderContent(execResult.result);
      const language =
        typeof execResult.result === "object" ? "json" : undefined;
      printBox(resultStr, `Result - ${timeStr}`, language, false);
    }

    if (execResult.logs && execResult.logs.length > 0) {
      printBox(execResult.logs.join("\n"), `Logs`, undefined, false);
    }

    if (execResult.error) {
      printBox(execResult.error, chalk.red("Error"), undefined, false);
    }
    return;
  }

  // Ultimate fallback: display raw output
  const outputStr = renderContent(output);
  const language = typeof output === "object" ? "json" : undefined;
  printBox(outputStr, "Result", language, false);
}

/**
 * Stream events with pretty printing
 */
export async function* prettyStreamEvents(
  streamEventsGenerator: AsyncGenerator<StreamEvent, void, void>
): AsyncGenerator<void, string, void> {
  let finalResponse = "";
  let isFirstTextChunk = true;
  let hasStreamedText = false;

  for await (const event of streamEventsGenerator) {
    if (event.event === "on_tool_start") {
      // Add newline after agent thinking if we streamed text
      if (hasStreamedText) {
        process.stdout.write("\n");
        hasStreamedText = false;
        isFirstTextChunk = true;
      }
      handleToolStart(event);
    } else if (event.event === "on_tool_end") {
      handleToolEnd(event);
    } else if (event.event === "on_chat_model_stream") {
      if (event.data?.chunk?.text) {
        const text = event.data.chunk.text;
        if (typeof text === "string" && text.length > 0) {
          // Add newline and robot emoji before first text chunk
          if (isFirstTextChunk) {
            process.stdout.write("\n🤖 ");
            isFirstTextChunk = false;
          }
          process.stdout.write(text);
          finalResponse += text;
          hasStreamedText = true;
        }
      }
    }

    yield;
  }

  return finalResponse;
}
