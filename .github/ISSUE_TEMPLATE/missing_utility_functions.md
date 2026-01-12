---
name: Add small, focused utility functions
about: Improve code maintainability through better function decomposition
title: Add small, focused utility functions for better code organization
labels: 'enhancement, refactor'
assignees: ''
---

**Describe the bug**
The codebase would benefit from more small, focused utility functions to improve readability, testability, and maintainability. Currently, complex operations are embedded within larger methods, making them harder to test and reuse.

**To Reproduce**
Steps to reproduce the behavior:
1. Review `libraries/typescript/packages/mcp-use/src/agents/mcp_agent.ts` - `stream` method
2. Review `libraries/python/mcp_use/agents/mcpagent.py` - `stream` method
3. Notice operations like message normalization, content extraction, tool update detection that are inline

**Expected behavior**
Extract reusable logic into small, focused utility functions:

**TypeScript (`mcp_agent.ts`):**
- `normalizeMessageContent(message)` - extract message content normalization
- `extractToolCallsFromMessage(message)` - extract tool call parsing
- `detectToolUpdates(currentTools, existingTools)` - extract tool update detection
- `shouldRestartExecution(toolUpdateDetected, restartCount, maxRestarts)` - extract restart logic
- `formatToolInputForLogging(toolInput)` - extract logging formatting
- `accumulateMessages(messages, accumulatedMessages)` - extract message accumulation

**Python (`mcpagent.py`):**
- `normalize_message_content(message)` - extract message content normalization
- `extract_tool_calls_from_message(message)` - extract tool call parsing
- `detect_tool_updates(current_tools, existing_tools)` - extract tool update detection
- `should_restart_execution(tool_update_detected, restart_count, max_restarts)` - extract restart logic
- `format_tool_input_for_logging(tool_input)` - extract logging formatting
- `accumulate_messages(messages, accumulated_messages)` - extract message accumulation

**Additional context**
- Utility functions should be pure functions where possible (no side effects)
- Functions should be easily testable in isolation
- Consider creating a separate utilities module/file for shared helpers
- These utilities can be reused across different agent implementations
- Improves code reusability and reduces duplication between TypeScript and Python implementations
