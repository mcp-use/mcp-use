import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { MCPClient } from "../../client.js";
import { BaseConnector } from "../../connectors/base.js";

export const CODE_MODE_AGENT_PROMPT = `
## MCP Code Mode Tool Usage Guide

You have access to an MCP Code Mode Client that allows you to execute JavaScript/TypeScript code with access to registered tools. Follow this workflow:

### 1. Tool Discovery Phase
**Always start by discovering available tools:**
- Tools are organized by server namespace (e.g., \`server_name.tool_name\`)
- Use the \`search_tools(query, detail_level)\` function to find available tools
- You can access \`__tool_namespaces\` to see all available server namespaces

\`\`\`javascript
// Find all GitHub-related tools
const tools = await search_tools("github");
for (const tool of tools) {
    console.log(\`\${tool.server}.\${tool.name}: \${tool.description}\`);
}

// Get only tool names for quick overview
const tools = await search_tools("", "names");
\`\`\`

### 2. Interface Introspection
**Understand tool contracts before using them:**
- Use \`search_tools\` to get tool descriptions and input schemas
- Look for "Access as: server.tool(args)" patterns in descriptions

### 3. Code Execution Guidelines
**When writing code:**
- Use \`await server.tool({ param: value })\` syntax for all tool calls
- Tools are async functions that return promises
- You have access to standard JavaScript globals: \`console\`, \`JSON\`, \`Math\`, \`Date\`, etc.
- All console output (\`console.log\`, \`console.error\`, etc.) is automatically captured and returned
- Build properly structured input objects based on interface definitions
- Handle errors appropriately with try/catch blocks
- Chain tool calls by using results from previous calls

### 4. Best Practices
- **Discover first, code second**: Always explore available tools before writing execution code
- **Respect namespaces**: Use full \`server.tool\` names to avoid conflicts
- **Minimize Context**: Process large data in code, return only essential results
- **Error handling**: Wrap tool calls in try/catch for robustness
- **Data flow**: Chain tools by passing outputs as inputs to subsequent tools

### 5. Available Runtime Context
- \`search_tools(query, detail_level)\`: Function to discover tools
- \`__tool_namespaces\`: Array of available server namespaces
- All registered tools as \`server.tool\` functions
- Standard JavaScript built-ins for data processing

### Example Workflow

\`\`\`javascript
// 1. Discover available tools
const github_tools = await search_tools("github pull request");
console.log(\`Available GitHub PR tools: \${github_tools.map(t => t.name)}\`);

// 2. Call tools with proper parameters
const pr = await github.get_pull_request({
    owner: "facebook",
    repo: "react",
    number: 12345
});

// 3. Process results
let result;
if (pr.state === 'open' && pr.labels.some(l => l.name === 'bug')) {
    // 4. Chain with other tools
    await slack.post_message({
        channel: "#bugs",
        text: \`🐛 Bug PR needs review: \${pr.title}\`
    });
    result = "Notification sent";
} else {
    result = "No action needed";
}

// 5. Return structured results
return {
    pr_number: pr.number,
    pr_title: pr.title,
    action_taken: result
};
\`\`\`

Remember: Always discover and understand available tools before attempting to use them in code execution.
`;

/**
 * CodeModeConnector provides a special "code mode" interface for executing JavaScript/TypeScript
 * code with access to MCP tools. Unlike other connectors, it doesn't establish its own external
 * connection - instead, it wraps an already-connected BaseMCPClient and exposes special tools
 * (execute_code, search_tools) on top of it.
 *
 * Since there's no connection phase to perform, the connector is immediately ready to use
 * (connected=true) upon construction. The connect() and disconnect() methods exist for
 * lifecycle compatibility with the BaseConnector interface but don't manage actual connections.
 */
export class CodeModeConnector extends BaseConnector {
  private mcpClient: MCPClient;
  private _tools: Tool[];

  constructor(client: MCPClient) {
    super();
    this.mcpClient = client;
    this.connected = true; // No connection phase needed - immediately ready
    this._tools = this._createToolsList();
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  get publicIdentifier(): Record<string, string> {
    return { name: "code_mode", version: "1.0.0" };
  }

  private _createToolsList(): Tool[] {
    return [
      {
        name: "execute_code",
        description:
          "Execute JavaScript/TypeScript code with access to MCP tools. " +
          "This is the PRIMARY way to interact with MCP servers in code mode. " +
          "Write code that discovers tools using search_tools(), " +
          "calls tools as async functions (e.g., await github.get_pull_request(...)), " +
          "processes data efficiently, and returns results. " +
          "Use 'await' for async operations and 'return' to return values. " +
          "Available in code: search_tools(), __tool_namespaces, and server.tool_name() functions.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description:
                "JavaScript/TypeScript code to execute. " +
                "Use 'await' for async operations. Use 'return' to return a value. " +
                "Available: search_tools(), server.tool_name(), __tool_namespaces",
            },
            timeout: {
              type: "number",
              description: "Execution timeout in milliseconds",
              default: 30000,
            },
          },
          required: ["code"],
        },
      },
      {
        name: "search_tools",
        description:
          "Search and discover available MCP tools across all servers. " +
          "Use this to find out what tools are available before writing code. " +
          "Returns tool information including names, descriptions, and schemas. " +
          "Can filter by query and control detail level.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query to filter tools by name or description",
              default: "",
            },
            detail_level: {
              type: "string",
              description: "Detail level: 'names', 'descriptions', or 'full'",
              enum: ["names", "descriptions", "full"],
              default: "full",
            },
          },
        },
      },
    ];
  }

  // Override tools getter to return static list immediately
  get tools(): Tool[] {
    return this._tools;
  }

  async initialize(): Promise<any> {
    this.toolsCache = this._tools;
    return { capabilities: {}, version: "1.0.0" };
  }

  async callTool(
    name: string,
    args: Record<string, any>
  ): Promise<CallToolResult> {
    if (name === "execute_code") {
      const code = args.code as string;
      const timeout = (args.timeout as number) || 30000;

      // We need to access executeCode on the client
      // Since BaseConnector doesn't know about executeCode, we cast client
      const result = await this.mcpClient.executeCode(code, timeout);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } else if (name === "search_tools") {
      const query = (args.query as string) || "";
      const detailLevel = args.detail_level as
        | "names"
        | "descriptions"
        | "full";

      const result = await this.mcpClient.searchTools(
        query,
        detailLevel && detailLevel in ["names", "descriptions", "full"]
          ? detailLevel
          : "full"
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  }
}
