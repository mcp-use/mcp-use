# Final Explanation - Mango v2 Architecture

## ✅ What Was Fixed

### Issue: Client Was Using Wrong API
The chat UI was calling `/api/chat/stream` (v1 with traditional tools) instead of `/api/chat/v2/stream` (new E2B-based architecture).

**Result:** Agent was calling `create_server` to scaffold a new project, when the project already exists in the E2B template!

### Fix Applied
Updated `src/client/hooks/useMangoChat.ts` to use `/api/chat/v2/stream` which:
1. Spawns E2B sandbox from template (project pre-created)
2. Agent modifies existing `/home/user/mcp-project`
3. **No `create_server` calls** - project already exists!

---

## ✅ Agent SDK API Fixed

### Issue: Invalid Parameters for SDK
Was trying to pass parameters that don't exist in the Agent SDK v2 API.

### Solution: Use Stable V1 API
Switched from unstable v2 to stable v1 [as documented](https://platform.claude.com/docs/en/agent-sdk/typescript):

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// V1 stable API
const queryGenerator = query({
  prompt: userMessage,
  options: {
    model: 'claude-sonnet-4-20250514',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',     // Use Claude Code's system prompt
      append: AGENT_SYSTEM_PROMPT // Add our custom instructions
    },
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    permissionMode: 'acceptEdits',  // Auto-approve file edits
    cwd: '/home/user/mcp-project',  // Working directory
  }
});

// Stream responses
for await (const msg of queryGenerator) {
  // msg contains assistant messages, tool uses, results, etc.
}
```

---

## ✅ No Custom Tools Needed

### Key Insight
**Claude Code already has all the tools we need** built-in:
- ✅ **Read**: Read files
- ✅ **Write**: Create/overwrite files
- ✅ **Edit**: String replacements
- ✅ **Bash**: Execute commands (npm, node, etc.)
- ✅ **Glob**: Find files by pattern
- ✅ **Grep**: Search file contents
- ✅ **TodoWrite**: Track tasks (automatic!)

We **don't implement** these - we just configure which ones the agent can use via `allowedTools`.

---

## Complete Architecture Flow

```
User: "Create calculator MCP server"
  ↓
Chat UI (/api/chat/v2/stream)
  ↓
E2B Manager
  ↓
Spawn E2B sandbox from template n2mcpgd7bntc0gia7l1b
  ↓
Template contains:
  /home/user/mcp-project/    ← ALREADY EXISTS!
    ├── src/index.ts         ← Pre-created
    ├── package.json
    ├── tsconfig.json
    └── node_modules/        ← Pre-installed
  ↓
Start agent runtime (tsx runtime.ts)
  ↓
Agent uses query() with:
  - model: 'claude-sonnet-4-20250514'
  - systemPrompt: Claude Code preset + our prompt
  - tools: Read, Write, Edit, Bash, TodoWrite
  - cwd: /home/user/mcp-project
  ↓
Agent:
  1. Reads /home/user/mcp-project/src/index.ts
  2. Understands existing structure
  3. Uses Edit tool to add calculator tool
  4. Uses Bash tool: "npm start"
  5. Server starts!
  ↓
E2B Manager detects server (checks localhost:3000-8080)
  ↓
Injects MCP server tools (future enhancement)
  ↓
Agent tests calculator via MCP tools
  ↓
Reports success with URL
```

---

## E2B Template

**Built and deployed!**
- **ID**: `n2mcpgd7bntc0gia7l1b`
- **Name**: `mcp-use-mango`
- **Contents**:
  - Node.js 20+
  - Claude Code (`@anthropic-ai/claude-code`)
  - Agent SDK (`@anthropic-ai/claude-agent-sdk@0.1.69`)
  - Pre-created MCP project at `/home/user/mcp-project`
  - All dependencies pre-installed

---

## Key Files

### Runtime (`src/sandbox-agent/runtime.ts`)
- Uses `query()` from V1 stable API
- Claude Code executes tools automatically
- Streams events to stdout (picked up by E2B manager)
- Detects MCP server startup

### System Prompt (`src/sandbox-agent/system-prompt.ts`)
- Appended to Claude Code's default prompt
- Instructs agent about the workflow
- Lists available tools

### E2B Manager (`src/server/e2b-manager.ts`)
- Spawns sandboxes from template
- Starts agent runtime
- Proxies messages stdin/stdout
- Detects server startup
- Plans MCP tool injection

### Chat API v2 (`src/server/routes/chat-v2.ts`)
- `POST /api/chat/v2/stream` - Main endpoint
- Creates sandbox on first message
- Streams agent events as SSE
- Handles cleanup

### Client Hook (`src/client/hooks/useMangoChat.ts`)
- Updated to use `/api/chat/v2/stream`
- Persistent `conversationId` across messages
- Handles v2 event types

---

## How Todos Work

Agent SDK V1 includes **TodoWrite** tool that agents use automatically:

```typescript
// Agent calls this internally
TodoWrite({
  todos: [
    { content: "Read existing code", status: "completed" },
    { content: "Add calculator tool", status: "in_progress" },
    { content: "Test the tool", status: "pending" }
  ]
})
```

**We parse these from the message stream** and display in UI!

---

## Testing

```bash
# Run Mango with Infisical (has all env vars)
infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm dev

# Open http://localhost:5175
# Send: "Create an MCP server with a calculator tool"
```

**Expected flow:**
1. ✅ Sandbox creates (2-3 seconds)
2. ✅ Agent reads `/home/user/mcp-project/src/index.ts`
3. ✅ Agent uses **Edit** tool to add calculator
4. ✅ Agent uses **Bash** tool: `npm start`
5. ✅ Server starts
6. ✅ Manager detects server running
7. ✅ (Future) MCP tools injected for testing
8. ✅ Agent reports success

---

## Concise Explanation

**Before:**
- Client called v1 API → Agent used `create_server` tool → Slow project creation

**After:**  
- Client calls v2 API → E2B sandbox with **pre-existing project** → Agent just modifies it

**Agent SDK:**
- Uses V1 stable `query()` API (not unstable v2)
- Claude Code provides all tools (Read, Write, Edit, Bash)
- TodoWrite tracks progress automatically
- No custom tool implementation needed

**Ready to use!** 🎉

