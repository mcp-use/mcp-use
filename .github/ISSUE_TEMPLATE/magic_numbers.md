---
name: Replace magic numbers with named constants
about: Improve code maintainability by replacing hardcoded values
title: Replace magic numbers with named constants or configuration
labels: 'enhancement, code-quality'
assignees: ''
---

**Describe the bug**
The codebase contains several "magic numbers" - hardcoded numeric values without clear documentation or named constants. This makes it difficult to understand the reasoning behind these values and to adjust them if needed.

**To Reproduce**
Steps to reproduce the behavior:
1. Open `libraries/typescript/packages/mcp-use/src/agents/mcp_agent.ts`
2. Find `const maxRestarts = 3;` at line 1274
3. Find `recursionLimit: this.maxSteps * 3` at line 1295
4. Check Python equivalent in `libraries/python/mcp_use/agents/mcpagent.py`

**Examples of magic numbers:**

**TypeScript (`mcp_agent.ts:1274`):**
```typescript
const maxRestarts = 3; // Prevent infinite restart loops
```

**TypeScript (`mcp_agent.ts:1295`):**
```typescript
recursionLimit: this.maxSteps * 3, // Set recursion limit to 3x maxSteps to account for model calls + tool executions
```

**Expected behavior**
Replace magic numbers with named constants or configuration options:

1. **`maxRestarts = 3`** - Should be:
   - A named constant: `const MAX_AGENT_RESTARTS = 3`
   - Or configurable: `this.config.maxRestarts ?? DEFAULT_MAX_RESTARTS`
   - Document why 3 is the default (prevent infinite loops while allowing tool updates)

2. **`recursionLimit: this.maxSteps * 3`** - Should be:
   - A named constant for the multiplier: `const RECURSION_LIMIT_MULTIPLIER = 3`
   - Or configurable: `this.config.recursionLimitMultiplier ?? DEFAULT_RECURSION_LIMIT_MULTIPLIER`
   - Document why 3x is used (accounts for model calls + tool executions)

**Proposed solution:**
```typescript
// At class level or in constants file
const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RECURSION_LIMIT_MULTIPLIER = 3;

// In stream method
const maxRestarts = this.config?.maxRestarts ?? DEFAULT_MAX_RESTARTS;
const recursionLimit = this.maxSteps * (this.config?.recursionLimitMultiplier ?? DEFAULT_RECURSION_LIMIT_MULTIPLIER);
```

**Additional context**
- Magic numbers make code harder to maintain and understand
- Named constants provide self-documenting code
- Configuration options allow runtime adjustment without code changes
- Should be applied to both TypeScript and Python implementations
- Consider adding these to agent configuration interfaces/types
- Document the rationale for default values in code comments or documentation
