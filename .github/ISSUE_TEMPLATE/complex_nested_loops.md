---
name: Refactor complex nested loops in agent streaming logic
about: Improve code readability and maintainability
title: Refactor complex nested loops in agent streaming logic
labels: 'refactor, code-quality'
assignees: ''
---

**Describe the bug**
The `stream` method in `MCPAgent` (and similar in Python `MCPAgent`) contains deeply nested loops that make the code difficult to read, test, and maintain. The streaming logic has up to 6 levels of nesting:

1. `while (restartCount <= maxRestarts)` - restart loop
2. `for await (const chunk of stream)` - stream chunk loop  
3. `for (const [nodeName, nodeOutput] of Object.entries(chunk))` - node iteration loop
4. `for (const msg of messages)` - message accumulation loop
5. `for (const message of messages)` - message processing loop
6. `for (const toolCall of message.tool_calls)` - tool call loop

**To Reproduce**
Steps to reproduce the behavior:
1. Open `libraries/typescript/packages/mcp-use/src/agents/mcp_agent.ts`
2. Navigate to the `stream` method (around line 1173)
3. Review lines 1281-1448 to see the nested loop structure
4. Similar issue exists in `libraries/python/mcp_use/agents/mcpagent.py` around line 746

**Expected behavior**
The nested loops should be refactored into smaller, focused utility functions:
- Extract message processing logic into separate functions
- Extract tool call handling into dedicated functions  
- Extract restart logic into a separate method
- Improve readability with better separation of concerns

**Additional context**
- Current implementation makes it difficult to test individual pieces of logic
- Deep nesting increases cognitive load when reading/debugging
- Similar patterns exist in both TypeScript and Python implementations
- Would benefit from extracting utilities like:
  - `processStreamChunk(chunk)` - handles chunk processing
  - `processMessages(messages)` - handles message iteration
  - `handleToolCalls(toolCalls)` - handles tool call processing
  - `checkForToolUpdates()` - handles restart detection logic
