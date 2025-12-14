# E2B Template for Mango - Apps SDK Edition
# This template includes a pre-created mcp-use project with apps-sdk template
FROM e2bdev/code-interpreter:latest
# Install global dependencies

# Create mcp_project using create-mcp-use-app with apps-sdk template
WORKDIR /home/user
RUN npx -y create-mcp-use-app@latest mcp_project --install --template apps-sdk

# Install all dependencies in the project
WORKDIR /home/user/mcp_project

# Create agent-runner directory for agent scripts and install dependencies
WORKDIR /home/user
RUN mkdir -p agent-runner
WORKDIR /home/user/agent-runner
RUN npm init -y && npm install @anthropic-ai/claude-agent-sdk@latest tsx@latest --legacy-peer-deps

# Set working directory back to home
WORKDIR /home/user
