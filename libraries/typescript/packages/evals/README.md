<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">@mcp-use/evals</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@mcp-use/evals" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/@mcp-use/evals.svg"/></a>
    <a href="https://www.npmjs.com/package/@mcp-use/evals" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/@mcp-use/evals.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🧪 **@mcp-use/evals** is an evaluation and testing framework for MCP (Model Context Protocol) agents. It provides tools to generate, run, and validate comprehensive test suites for MCP servers, measuring agent behavior, tool usage, and semantic quality.

💡 Automatically generate test suites from MCP server descriptors, evaluate agent responses with LLM judges, and ensure your MCP tools work as expected.

## 📦 Related Packages

| Package                                                                                                             | Description             | Version                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| [mcp-use](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use)                       | Core MCP framework      | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| [@mcp-use/cli](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/cli)                      | Build tool for MCP apps | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             |
| [@mcp-use/inspector](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)          | Web-based MCP inspector | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |

---

## ✨ Key Features

| Feature                          | Description                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------- |
| 🤖 **LLM-Powered Test Generation** | Automatically generate comprehensive test suites from MCP server schemas        |
| 🎯 **Semantic Evaluation**        | Validate agent responses using LLM judges for behavioral correctness            |
| 📊 **Rich Assertions**            | Custom matchers for tool calls, resource access, errors, and execution metrics  |
| 🔧 **Flexible Configuration**     | Project-level config for agents, servers, and test defaults                     |
| 📝 **TypeScript First**           | Generated tests are fully typed Vitest files ready to run                       |
| 🧪 **Multiple Test Categories**   | Direct, indirect, negative, and error tests for comprehensive coverage          |
| 🎨 **Customizable Prompts**       | Configure agent behavior with `additionalInstructions` per project              |
| 📈 **Metrics Tracking**           | Monitor token usage, execution time, and tool call patterns                     |

---

## 🚀 Quick Start

### Requirements

- Node.js 20.19.0 or higher
- An LLM API key (OpenAI or Anthropic)

### Installation

```bash
# Install the package
npm install --save-dev @mcp-use/evals

# Required peer dependencies
npm install mcp-use @langchain/openai @langchain/anthropic vitest
```

### Setup

1. **Create an eval config file** (`eval.config.json`):

```json
{
  "default": {
    "runAgent": "gpt",
    "judgeAgent": "gpt"
  },
  "agents": {
    "gpt": {
      "provider": "openai",
      "model": "gpt-4o"
    }
  },
  "servers": {
    "myServer": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  },
  "defaults": {
    "timeout": 30000,
    "retries": 0,
    "serverLifecycle": "suite",
    "additionalInstructions": "Only use tools when explicitly requested by the user."
  }
}
```

2. **Set your API key**:

```bash
export OPENAI_API_KEY=your_key_here
# or
export ANTHROPIC_API_KEY=your_key_here
```

3. **Generate tests** for your MCP server:

```bash
npx @mcp-use/evals generate
```

This will:
- Inspect your MCP server(s) to discover tools and resources
- Use an LLM to plan comprehensive test cases
- Generate a fully typed Vitest test file

4. **Run the tests**:

```bash
npx vitest run
```

---

## 📖 Usage

### Interactive Test Generation

The `generate` command provides an interactive experience:

```bash
npx @mcp-use/evals generate
```

**Workflow:**
1. Select which MCP servers to test
2. LLM analyzes server capabilities
3. LLM generates test plan with multiple test categories
4. Code generator creates a `.eval.test.ts` file
5. Tests are ready to run with Vitest

**Options:**
```bash
# Specify servers
npx @mcp-use/evals generate --servers myServer,anotherServer

# Custom config path
npx @mcp-use/evals generate --config path/to/eval.config.json

# Custom output file
npx @mcp-use/evals generate --output tests/my-server.eval.test.ts
```

### Writing Manual Tests

You can also write tests manually using the eval framework:

```typescript
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createEvalAgent, describeIfConfigured, judge } from "@mcp-use/evals";

describeIfConfigured("my server", () => {
  let agent: any;

  beforeAll(async () => {
    agent = await createEvalAgent({
      servers: ["myServer"],
    });
  });

  afterAll(async () => {
    await agent.cleanup();
  });

  it("should list files", async () => {
    const result = await agent.run("List files in the current directory");
    
    // Exact assertions
    expect(result).toHaveUsedTool("list_directory");
    expect(result).toHaveCompletedWithinMs(5000);
    
    // Semantic assertions
    const judgeResult = await judge(
      result.output, 
      "Agent successfully lists files"
    );
    expect(judgeResult.score).toBeGreaterThan(0.7);
  });

  it("should NOT use tools for unrelated queries", async () => {
    const result = await agent.run("What is the weather today?");
    
    expect(result).not.toHaveUsedTool("list_directory");
  });
});
```

---

## 🧪 Test Categories

The framework generates four types of tests:

### Direct Tests
Test explicit tool usage with specific parameters:
```typescript
// Prompt: "List all files with extension .txt"
expect(result).toHaveUsedTool("list_directory");
expect(result).toHaveToolCallWith("list_directory", { extension: ".txt" });
```

### Indirect Tests
Test natural language understanding without mentioning tool names:
```typescript
// Prompt: "Show me what's in the folder"
expect(result).toHaveUsedTool("list_directory");
const judgeResult = await judge(result.output, "Agent displays folder contents");
expect(judgeResult.score).toBeGreaterThan(0.7);
```

### Negative Tests
Ensure tools are NOT used for unrelated queries:
```typescript
// Prompt: "What is the weather today?"
expect(result).not.toHaveUsedTool("list_directory");
```

### Error Tests
Verify graceful handling of invalid inputs:
```typescript
// Prompt: "Delete a file without providing its path"
expect(result).toHaveToolCallFailed("delete_file");
```

---

## 🎯 Custom Matchers

The framework provides rich assertions for agent behavior:

```typescript
// Tool usage
expect(result).toHaveUsedTool("toolName");
expect(result).not.toHaveUsedTool("toolName");
expect(result).toHaveToolCallCount("toolName", 3);

// Tool inputs and outputs
expect(result).toHaveToolCallWith("toolName", { param: "value" });
expect(result).toHaveToolCallResult("toolName", "expected output");

// Tool execution order
expect(result).toHaveCalledToolsInOrder("tool1", "tool2", "tool3");

// Resource access
expect(result).toHaveUsedResource("resourceName");

// Output validation
expect(result).toHaveOutputContaining("expected text");

// Error handling
expect(result).toHaveFailed();
expect(result).toHaveFailedWith("error message");
expect(result).toHaveToolCallFailed("toolName");
expect(result).toHaveToolCallFailedWith("toolName", "error text");

// Performance metrics
expect(result).toHaveCompletedWithinMs(5000);
expect(result).toHaveUsedLessThanTokens(1000);
```

---

## 🤖 Semantic Judge

For complex behavioral validation, use the `judge` function:

```typescript
import { judge } from "@mcp-use/evals";

const result = await agent.run("Summarize the latest news");

const judgeResult = await judge(
  result.output,
  "Agent provides a concise summary of recent news articles"
);

// Returns: { score: 0.85, reasoning: "Agent successfully..." }
expect(judgeResult.score).toBeGreaterThan(0.7);
```

The judge uses an LLM to evaluate whether the agent's output meets your behavioral expectation, returning a score (0-1) and reasoning.

---

## ⚙️ Configuration

### Agent Configuration

Define LLM providers in `eval.config.json`:

```json
{
  "agents": {
    "gpt": {
      "provider": "openai",
      "model": "gpt-4o"
    },
    "claude": {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022"
    },
    "local": {
      "provider": "openai",
      "model": "llama-3",
      "baseUrl": "http://localhost:11434/v1"
    }
  }
}
```

### Server Configuration

Support for all MCP connection types:

```json
{
  "servers": {
    "stdio-server": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"]
    },
    "http-server": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    },
    "sse-server": {
      "type": "sse",
      "url": "https://api.example.com/mcp/sse"
    }
  }
}
```

### Test Defaults

Configure test behavior:

```json
{
  "defaults": {
    "timeout": 30000,
    "retries": 2,
    "serverLifecycle": "suite",
    "additionalInstructions": "Custom instructions for agent behavior"
  }
}
```

**Options:**
- `timeout`: Max execution time per test (ms)
- `retries`: Number of retry attempts for flaky tests
- `serverLifecycle`: `"suite"` (start once) or `"test"` (restart per test)
- `additionalInstructions`: Custom prompt instructions for the agent

---

## 🛠️ API Reference

### `createEvalAgent(options)`

Creates an eval agent with tracking capabilities.

```typescript
import { createEvalAgent } from "@mcp-use/evals";

const agent = await createEvalAgent({
  servers: ["myServer"],          // Server names from config
  configPath: "./eval.config.json", // Optional config path
  runAgent: "gpt",                // Optional agent override
  judgeAgent: "claude",           // Optional judge override
  serverLifecycle: "test",        // Optional lifecycle override
});
```

### `describeIfConfigured(name, fn)`

Conditionally run test suite based on API key presence:

```typescript
import { describeIfConfigured } from "@mcp-use/evals";

describeIfConfigured("my server", () => {
  // Tests only run if OPENAI_API_KEY or ANTHROPIC_API_KEY is set
  it("should work", async () => {
    // ...
  });
});
```

### `judge(output, expectation)`

Semantic evaluation of agent output:

```typescript
import { judge } from "@mcp-use/evals";

const judgeResult = await judge(
  "The capital of France is Paris.",
  "Correctly identifies Paris as the capital of France"
);

// Returns: { score: 0.95, reasoning: "The agent correctly..." }
```

---

## 📚 Examples

Check out the `/tests` directory for real-world examples:
- `tests/integration/runtime_tool_usage.test.ts` - Tool tracking examples
- `tests/integration/runtime_resource_usage.test.ts` - Resource access tests
- `tests/integration/judge_smoke.test.ts` - Semantic judge examples
- `tests/kanban.eval.test.ts` - Full eval test suite example

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT © [mcp-use](https://github.com/mcp-use)

---

## 🔗 Links

- [Main Repository](https://github.com/mcp-use/mcp-use)
- [Documentation](https://mcp-use.com/docs)
- [Discord Community](https://discord.gg/XkNkSkMz3V)
- [Report Issues](https://github.com/mcp-use/mcp-use/issues)

---

## 🙏 Acknowledgments

Built on top of:
- [mcp-use](https://github.com/mcp-use/mcp-use) - MCP framework
- [Vitest](https://vitest.dev/) - Testing framework
- [LangChain.js](https://js.langchain.com/) - LLM orchestration
- [ts-morph](https://ts-morph.com/) - TypeScript code generation
