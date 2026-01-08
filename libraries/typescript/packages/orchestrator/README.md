# @mcp-use/orchestrator

Multi-agent orchestration for MCP workflows. Compose, coordinate, and manage multiple AI agents working together.

## Features

- 🔗 **Workflow Composition** - Chain multiple agents in complex workflows
- ⚡ **Parallel Execution** - Run agents concurrently for faster results
- 🔄 **Error Recovery** - Retry failed steps with fallback agents
- 📊 **Context Passing** - Share data between agents seamlessly
- ⚙️ **Conditional Logic** - Execute steps based on previous results
- 📈 **Observability** - Track execution with detailed traces

## Installation

```bash
npm install @mcp-use/orchestrator
```

**Prerequisites**: Requires `mcp-use` >= 2.0.0

## Quick Start

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "mcp-use";
import { MCPOrchestrator } from "@mcp-use/orchestrator";

// Create specialized agents
const client = MCPClient.fromDict({ /* config */ });
const llm = new ChatOpenAI({ modelName: "gpt-4o" });

const researcher = new MCPAgent({ llm, client, systemPrompt: "You are a researcher..." });
const writer = new MCPAgent({ llm, client, systemPrompt: "You are a writer..." });

// Create orchestrator
const orchestrator = new MCPOrchestrator({
  agents: {
    researcher,
    writer,
  },
  workflow: {
    name: "research-and-write",
    steps: [
      { id: "research", agent: "researcher", outputKey: "research" },
      { id: "write", agent: "writer", input: (ctx) => ctx.get("research") },
    ],
  },
});

// Run workflow
const result = await orchestrator.run("Write about AI agents");
console.log(result.output);
```

## Core Concepts

### Agents

Each agent is a specialized `MCPAgent` with its own:
- System prompt (defines role/expertise)
- MCP tools (capabilities)
- LLM model

```typescript
const agents = {
  classifier: new MCPAgent({ /* specialized for classification */ }),
  handler: new MCPAgent({ /* specialized for handling */ }),
};
```

### Workflows

Workflows define the sequence and logic of agent execution:

```typescript
const workflow = {
  name: "my-workflow",
  steps: [
    { id: "step1", agent: "classifier", outputKey: "category" },
    { id: "step2", agent: "handler", condition: (ctx) => ctx.get("category") === "bug" },
  ],
};
```

### Context

Context stores data passed between agents:

```typescript
// Step 1 stores result
{ id: "step1", agent: "agent1", outputKey: "result" }

// Step 2 uses result
{ id: "step2", agent: "agent2", input: (ctx) => ctx.get("result") }
```

## Examples

### Sequential Workflow

```typescript
const orchestrator = new MCPOrchestrator({
  agents: { agent1, agent2, agent3 },
  workflow: {
    name: "sequential",
    steps: [
      { id: "step1", agent: "agent1", outputKey: "output1" },
      { id: "step2", agent: "agent2", input: (ctx) => ctx.get("output1") },
      { id: "step3", agent: "agent3" },
    ],
  },
});
```

### Parallel Workflow

```typescript
const orchestrator = new MCPOrchestrator({
  agents: { searchA, searchB, synthesizer },
  workflow: {
    name: "parallel-search",
    steps: [
      { id: "searchA", agent: "searchA", outputKey: "resultsA", parallel: ["searchB"] },
      { id: "searchB", agent: "searchB", outputKey: "resultsB" },
      { id: "synthesize", agent: "synthesizer", input: (ctx) => 
        `A: ${ctx.get("resultsA")}\nB: ${ctx.get("resultsB")}`
      },
    ],
  },
  parallelization: true,
});
```

### Conditional Workflow

```typescript
const orchestrator = new MCPOrchestrator({
  agents: { classifier, bugHandler, questionHandler },
  workflow: {
    name: "conditional-routing",
    steps: [
      { id: "classify", agent: "classifier", outputKey: "type" },
      { id: "bug", agent: "bugHandler", condition: (ctx) => ctx.get("type") === "bug" },
      { id: "question", agent: "questionHandler", condition: (ctx) => ctx.get("type") === "question" },
    ],
  },
});
```

### Error Recovery

```typescript
const orchestrator = new MCPOrchestrator({
  agents: { primaryAgent, fallbackAgent },
  workflow: {
    name: "with-fallback",
    steps: [
      { 
        id: "process", 
        agent: "primaryAgent",
        fallbackAgent: "fallbackAgent",  // Use if primary fails
        maxRetries: 3,
        retryOn: "error",
      },
    ],
  },
  errorRecovery: "fallback",
});
```

## API Reference

### MCPOrchestrator

```typescript
constructor(options: OrchestratorOptions)
```

**Options**:
- `agents`: Record<string, MCPAgent> - Map of agent name to instance
- `workflow`: WorkflowDefinition - Workflow configuration
- `parallelization?`: boolean - Enable parallel execution (default: true)
- `errorRecovery?`: "retry" | "fallback" | "skip" - Error strategy (default: "retry")
- `maxRetries?`: number - Max retries per step (default: 3)
- `verbose?`: boolean - Detailed logging (default: false)

**Methods**:
- `run(input: string): Promise<WorkflowResult>` - Execute workflow
- `runStep(stepId: string, input: any): Promise<StepResult>` - Run single step
- `getExecutionTrace(): StepResult[]` - Get execution history

### WorkflowDefinition

```typescript
interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  onError?: "stop" | "continue" | "rollback";
  timeoutMs?: number;
}
```

### WorkflowStep

```typescript
interface WorkflowStep {
  id: string;
  agent: string;
  input?: string | ((context: WorkflowContext) => string);
  outputKey?: string;
  condition?: (context: WorkflowContext) => boolean;
  parallel?: string[]; 
  retryOn?: "error" | "validation" | "always";
  fallbackAgent?: string;
  maxRetries?: number;
}
```

### WorkflowResult

```typescript
interface WorkflowResult {
  workflow: string;
  success: boolean;
  output: any;
  steps: StepResult[];
  totalDurationMs: number;
  context: Record<string, any>;
  error?: Error;
}
```

## Best Practices

### Agent Specialization

Create focused agents with clear responsibilities:

```typescript
// ✅ Good - Specialized agents
const bugClassifier = new MCPAgent({ systemPrompt: "Classify bugs only..." });
const featureClassifier = new MCPAgent({ systemPrompt: "Classify features only..." });

// ❌ Bad - Generic agent doing everything
const classifier = new MCPAgent({ systemPrompt: "Classify anything..." });
```

### Context Management

Use descriptive keys for context storage:

```typescript
// ✅ Good
{ outputKey: "userPreferences" }
{ outputKey: "searchResults" }

// ❌ Bad
{ outputKey: "result1" }
{ outputKey: "data" }
```

### Error Handling

Always specify fallback strategies:

```typescript
// ✅ Good
workflow: {
  steps: [{ agent: "primary", fallbackAgent: "backup", maxRetries: 3 }],
  onError: "continue",
}

// ❌ Bad - No fallback
workflow: {
  steps: [{ agent: "primary" }],
}
```

## Advanced Usage

### Dynamic Inputs

Transform context data for each step:

```typescript
{
  id: "analyze",
  agent: "analyzer",
  input: (ctx) => {
    const rawData = ctx.get("data");
    return `Analyze this: ${JSON.stringify(rawData)}`;
  },
}
```

### Conditional Execution

Skip steps based on previous results:

```typescript
{
  id: "escalate",
  agent: "escalator",
  condition: (ctx) => {
    const severity = ctx.get("severity");
    return severity === "critical";
  },
}
```

### Parallel Groups

Run multiple agents simultaneously:

```typescript
{
  id: "search1",
  agent: "searchAgent",
  parallel: ["search2", "search3"], // All 3 run at same time
}
```

## Troubleshooting

**Workflow validation errors**:
- Ensure all agent names exist in config
- Check for typos in step IDs
- Verify fallback agent references

**Steps not executing**:
- Check condition functions
- Verify context keys match outputKey values
- Enable verbose logging

**Performance issues**:
- Enable parallelization for independent steps
- Reduce retry counts
- Optimize agent system prompts

## Examples Directory

See `/examples` for complete working examples:
- `customer-support.ts` - Conditional routing workflow
- `research-parallel.ts` - Parallel execution workflow

## License

MIT

## Contributing

Contributions welcome! This package extends mcp-use without modifying core code.

---

Built with ❤️ for the mcp-use community
