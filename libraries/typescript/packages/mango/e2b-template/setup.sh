#!/bin/bash
# E2B Template Setup Script
# Run this to create a custom E2B template with all dependencies pre-installed
# Usage: bash setup.sh

set -e

echo "🔧 Setting up Mango E2B template..."

# Update and install Node.js if needed
echo "📦 Ensuring Node.js is installed..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

node --version
npm --version

# Create agent runner directory
echo "📁 Creating agent runner directory..."
mkdir -p /home/user/agent-runner
cd /home/user/agent-runner

# Write package.json
cat > package.json << 'EOF'
{
  "name": "mango-agent-runner",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0"
  }
}
EOF

# Install dependencies
echo "📦 Installing agent runner dependencies..."
npm install

# Write the agent runner script
cat > index.ts << 'EOF'
import { query } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = `You are an MCP server development and testing agent.

You are running inside an isolated E2B sandbox with full access to:
- Bash commands (npm, node, git, etc.)
- File read/write operations  
- The /home/user/mcp-project directory with a pre-scaffolded MCP server

WORKFLOW:
1. First, explore the project structure with ls and read files
2. Understand the user's requirements
3. Implement the MCP server in src/index.ts
4. Install any needed dependencies with npm install
5. Test with: npm run build && npm start
6. Iterate until working

RULES:
- Be thorough but concise
- Show your work by reading files before editing
- Test your changes
- Report errors clearly

Your goal: Build a working MCP server that meets all user requirements.`;

// Read prompt from command line args
const prompt = process.argv[2];
if (!prompt) {
  console.log(JSON.stringify({ type: "error", error: "No prompt provided" }));
  process.exit(1);
}

// Output function - writes JSON to stdout
const emit = (data: any) => console.log(JSON.stringify(data));

async function run() {
  try {
    emit({ type: "status", status: "starting" });
    
    for await (const event of query({
      prompt,
      options: {
        model: "claude-sonnet-4-20250514",
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 50,
        permissionMode: "acceptEdits",
      }
    })) {
      if (event.type === "assistant") {
        emit({ type: "assistant", message: event.message });
        // Extract todos
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_use" && block.name === "TodoWrite") {
              emit({ type: "todo_update", todos: (block.input as any)?.todos || [] });
            }
          }
        }
      } else if (event.type === "stream_event") {
        emit({ type: "stream_event", event: event.event });
      } else if (event.type === "tool_result") {
        emit({ type: "tool_result", tool_use_id: event.tool_use_id });
      } else if (event.type === "result") {
        emit({ type: "result", subtype: event.subtype });
      }
    }
    emit({ type: "done" });
  } catch (error: any) {
    emit({ type: "error", error: error.message });
    process.exit(1);
  }
}

run();
EOF

# Create MCP project using create-mcp-use-app
echo "📁 Creating MCP project with create-mcp-use-app..."
cd /home/user
npx create-mcp-use-app mcp-project --template apps-sdk --install

echo ""
echo "✅ E2B template setup complete!"
echo ""
echo "📁 Agent runner: /home/user/agent-runner"
echo "📁 MCP project: /home/user/mcp-project"
echo ""
echo "To create the E2B template:"
echo "  1. Make sure you're inside an E2B sandbox"
echo "  2. Run: e2b template build"
echo "  3. Note the template ID"
echo "  4. Set E2B_TEMPLATE_ID in your .env"
