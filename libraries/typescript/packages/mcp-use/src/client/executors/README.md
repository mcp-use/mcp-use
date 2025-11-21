# Code Executors Architecture

This directory contains the code execution infrastructure for MCP's Code Mode, which allows AI agents to interact with MCP tools by writing and executing JavaScript/TypeScript code instead of calling tools individually.

## Architecture Overview

Code Mode uses a layered architecture to provide flexible, secure code execution with MCP tool access:

```
┌─────────────────────────────────────────────────────────────┐
│                         MCPAgent                            │
│  (LLM-powered agent with CODE_MODE system prompt)          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCPClient                              │
│  codeMode: true                                             │
│  Manages MCP server sessions + code execution               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
┌───────────────────────────┐  ┌──────────────────────────────┐
│  CodeModeConnector        │  │  Real MCP Servers            │
│  (Internal Meta-Server)   │  │  (filesystem, github, etc.)  │
│                           │  │                              │
│  Tools:                   │  │  Provide: tools, resources,  │
│  - execute_code           │  │           prompts            │
│  - search_tools           │  │                              │
└───────────┬───────────────┘  └──────────────┬───────────────┘
            │                                  │
            ▼                                  │
┌─────────────────────────────────────────────┼───────────────┐
│           BaseCodeExecutor                  │               │
│  (Abstract base class)                      │               │
│                                             │               │
│  Responsibilities:                          │               │
│  - Server connection management             │               │
│  - Tool namespace discovery                 │               │
│  - Tool search function creation            │               │
└───────────┬─────────────────────────────────┘               │
            │                                                 │
       ┌────┴────┐                                           │
       ▼         ▼                                           │
┌──────────┐ ┌────────────┐                                 │
│   VM     │ │    E2B     │                                 │
│ Executor │ │  Executor  │                                 │
└──────────┘ └────────────┘                                 │
     │              │                                        │
     │              │  Tool calls proxied back ──────────────┘
     ▼              ▼
 (Local VM)   (Remote Sandbox)
```

### Flow

1. **Agent discovers tools** using the `search_tools` tool provided by CodeModeConnector
2. **Agent writes JavaScript code** that calls tools as async functions (e.g., `await github.list_issues(...)`)
3. **Agent executes code** via the `execute_code` tool
4. **CodeModeConnector** routes execution to the configured executor
5. **Executor** runs the code with MCP tools exposed in the execution environment
6. **Tool calls** are either:
   - **VM**: Direct function calls to MCP connectors (fast, local)
   - **E2B**: Proxied via bridge pattern from remote sandbox to host (secure, isolated)
7. **Results** are captured and returned to the agent

## BaseCodeExecutor

The abstract base class that provides shared functionality for all executors.

### Key Responsibilities

#### 1. Server Connection Management
```typescript
protected async ensureServersConnected(): Promise<void>
```
- Ensures all configured MCP servers are connected before code execution
- Prevents race conditions with a connection lock (`_connecting` flag)
- Automatically creates sessions for missing servers

#### 2. Tool Namespace Discovery
```typescript
protected getToolNamespaces(): ToolNamespaceInfo[]
```
- Retrieves tool information from all active MCP sessions
- Organizes tools by server namespace (e.g., `github`, `filesystem`)
- Filters out the internal `code_mode` server to avoid recursion

#### 3. Tool Search Function
```typescript
public createSearchToolsFunction(): SearchToolsFunction
```
- Creates a search function for runtime tool discovery
- Supports filtering by query string
- Offers three detail levels:
  - `"names"`: Just tool name and server
  - `"descriptions"`: Name, server, and description
  - `"full"`: Complete schema including `inputSchema`

### Abstract Methods

Subclasses must implement:

```typescript
abstract execute(code: string, timeout?: number): Promise<ExecutionResult>;
abstract cleanup(): Promise<void>;
```

### ExecutionResult Interface

```typescript
interface ExecutionResult {
  result: unknown;        // The return value from the code
  logs: string[];         // Console output (log, error, warn)
  error: string | null;   // Error message if execution failed
  execution_time: number; // Time in seconds
}
```

## VMCodeExecutor

**Local execution using Node.js vm module.**

### How It Works

1. **Context Building** (`_buildContext`):
   - Creates an isolated V8 context with safe globals
   - Injects tool namespaces as async functions
   - Adds `search_tools` helper and `console` handlers
   - Blocks access to `require`, `import`, `process`, `fs`, etc.

2. **Code Wrapping**:
   ```javascript
   (async () => {
     try {
       ${code}
     } catch (e) {
       throw e;
     }
   })()
   ```
   - Wraps user code in async IIFE to support `await`
   - Captures return value and errors

3. **Tool Exposure**:
   - Tools are exposed as `serverName.toolName(args)` async functions
   - Direct function calls to `session.connector.callTool()`
   - Results are automatically extracted from MCP response format

4. **Execution**:
   - Uses `vm.Script` with timeout support
   - Runs in isolated context with `runInNewContext()`
   - Captures console output in logs array

### Advantages
- **Fast**: No network overhead, direct function calls
- **Simple**: No external dependencies
- **Synchronous setup**: Immediate execution without sandbox provisioning

### Limitations
- **Security**: VM isolation is not perfect for untrusted code
- **Environment**: Limited to Node.js built-ins only
- **Resources**: Shares host process resources

### Example Tool Call Flow

```
User Code: await github.list_issues({ owner: "foo", repo: "bar" })
     ↓
VM Context serverNamespace['github']['list_issues']({ owner: "foo", repo: "bar" })
     ↓
session.connector.callTool('list_issues', { owner: "foo", repo: "bar" })
     ↓
MCP GitHub Server
     ↓
Return result (extracted from MCP content format)
```

## E2BCodeExecutor

**Remote execution using E2B cloud sandboxes.**

### How It Works

1. **Sandbox Management**:
   - Lazy-loads `@e2b/code-interpreter` (optional dependency)
   - Creates persistent sandbox instance (`getOrCreateCodeExecSandbox`)
   - Reuses sandbox across multiple executions
   - Configurable timeout (default: 5 minutes)

2. **Tool Bridge Pattern** (`generateShim`):
   - Generates JavaScript shim code that runs in the sandbox
   - Creates global `__callMcpTool(server, tool, args)` function
   - Implements bidirectional communication via:
     - **Tool Call**: `console.log(JSON.stringify({ type: '__MCP_TOOL_CALL__', ... }))`
     - **Result**: File-based polling at `/tmp/mcp_result_${id}.json`
   - Exposes tools as `serverName.toolName(args)` wrappers

3. **Code Execution**:
   - Writes shim + user code to sandbox filesystem
   - Executes as Node.js script
   - Monitors stdout for tool call requests
   - Proxies tool calls back to host
   - Writes results back to sandbox filesystem

4. **Result Extraction**:
   - Uses marker pattern: `__MCP_RESULT_START__` ... `__MCP_RESULT_END__`
   - Cleans tool call logs from output
   - Captures console logs and errors

### The Bridge Pattern

The bridge allows code in the remote E2B sandbox to call MCP tools on the host:

```
┌─────────────────────────────────────────────────────────────┐
│  E2B Sandbox (Remote)                                       │
│                                                             │
│  User Code:                                                 │
│    const issues = await github.list_issues(args)           │
│         ↓                                                   │
│  Shim Wrapper:                                              │
│    async (args) => await __callMcpTool('github',           │
│                                         'list_issues',      │
│                                         args)               │
│         ↓                                                   │
│  __callMcpTool:                                             │
│    1. console.log(JSON.stringify({                          │
│         type: '__MCP_TOOL_CALL__',                          │
│         id: 'abc123',                                       │
│         server: 'github',                                   │
│         tool: 'list_issues',                                │
│         args: { ... }                                       │
│       }))                                                   │
│    2. Poll for /tmp/mcp_result_abc123.json                 │
│    3. Return parsed result                                 │
└─────────────────────────────────────────────────────────────┘
                            │ stdout
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Host (MCPClient)                                           │
│                                                             │
│  onStdout handler:                                          │
│    1. Parse JSON line with type '__MCP_TOOL_CALL__'        │
│    2. Look up session for server 'github'                  │
│    3. Call session.connector.callTool('list_issues', args) │
│    4. Extract result from MCP format                       │
│    5. Write to /tmp/mcp_result_abc123.json in sandbox      │
└─────────────────────────────────────────────────────────────┘
```

### Shim Code Structure

```javascript
// Bridge function
global.__callMcpTool = async (server, tool, args) => {
  const id = Math.random().toString(36).substring(7);
  console.log(JSON.stringify({
    type: '__MCP_TOOL_CALL__',
    id, server, tool, args
  }));
  
  const resultPath = `/tmp/mcp_result_${id}.json`;
  // Poll for result with timeout
  while (attempts < 300) {
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      fs.unlinkSync(resultPath);
      if (result.error) throw new Error(result.error);
      return result.data;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  throw new Error('Tool execution timed out');
};

// Tool namespaces
global['github'] = {
  'list_issues': async (args) => await __callMcpTool('github', 'list_issues', args),
  'get_pull_request': async (args) => await __callMcpTool('github', 'get_pull_request', args),
  // ... more tools
};

// search_tools helper (with tools embedded as JSON)
global.search_tools = async (query, detailLevel = 'full') => {
  const allTools = [/* embedded tool catalog */];
  // Filter and return based on query and detail level
};
```

### Advantages
- **Security**: True isolation in cloud sandbox
- **Environment**: Full Linux environment with filesystem, network
- **Resources**: Dedicated compute resources
- **Persistence**: Sandbox persists across executions

### Limitations
- **Latency**: Network overhead for sandbox communication
- **Cost**: Requires E2B API key and usage billing
- **Complexity**: Bridge pattern adds debugging complexity
- **Dependency**: Requires `@e2b/code-interpreter` package

### Error Handling

- **Sandbox creation failures**: Throws helpful error with installation instructions
- **Tool execution errors**: Captured and written to result file
- **Timeout handling**: Both sandbox-level and tool-level timeouts
- **Cleanup**: Automatic sandbox cleanup on executor disposal

## When to Use Each Executor

### Use VMCodeExecutor when:
- Running in trusted environment (local development, CI)
- Need fast execution with minimal latency
- Working with simple data processing tasks
- Don't need full Linux environment features
- Want zero external dependencies

### Use E2BCodeExecutor when:
- Executing untrusted or user-generated code
- Need strong isolation guarantees
- Require full Linux environment (filesystem, network, packages)
- Building production systems with multi-tenancy
- Willing to pay for enhanced security and isolation

### Custom Executor when:
- Integrating with proprietary sandbox solutions
- Need specialized execution environments
- Have unique security or compliance requirements
- Want to add custom instrumentation or monitoring

## Configuration

### VM Executor (Default)
```typescript
const client = new MCPClient(config, {
  codeMode: true,
  // codeExecutor: "vm" is the default
});
```

### E2B Executor
```typescript
const client = new MCPClient(config, {
  codeMode: true,
  codeExecutor: "e2b",
  e2bApiKey: process.env.E2B_API_KEY,
  e2bTimeoutMs: 300000, // 5 minutes
});
```

### Custom Executor Function
```typescript
const client = new MCPClient(config, {
  codeMode: true,
  codeExecutor: async (code: string, timeout?: number) => {
    // Custom execution logic
    return {
      result: /* ... */,
      logs: [],
      error: null,
      execution_time: 1.5
    };
  }
});
```

### Custom Executor Class
```typescript
class MyExecutor extends BaseCodeExecutor {
  async execute(code: string, timeout?: number): Promise<ExecutionResult> {
    // Custom implementation
  }
  
  async cleanup(): Promise<void> {
    // Resource cleanup
  }
}

const client = new MCPClient(config, {
  codeMode: true,
  codeExecutor: new MyExecutor(client)
});
```

## File Reference

- **`base.ts`**: Abstract base class with shared utilities
- **`vm.ts`**: Local Node.js vm-based executor
- **`e2b.ts`**: Remote E2B sandbox executor with bridge pattern
- **`../codeExecutor.ts`**: Re-exports and type definitions
- **`../connectors/codeMode.ts`**: CodeModeConnector that provides execute_code and search_tools
- **`../prompts.ts`**: CODE_MODE_AGENT_PROMPT for instructing LLMs

## Related Documentation

- User documentation: `/docs/typescript/client/code-mode.mdx`
- Examples: `/examples/client/code_mode_example.ts`, `/examples/client/code_mode_e2b_example.ts`
- Anthropic research: https://www.anthropic.com/engineering/code-execution-with-mcp

