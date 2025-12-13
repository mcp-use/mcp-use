#!/bin/bash
set -e

echo "🚀 Creating E2B template with pre-scaffolded MCP project..."

# Create temporary directory for template setup
TEMP_DIR=$(mktemp -d)
echo "📁 Using temporary directory: $TEMP_DIR"

cd "$TEMP_DIR"

# Install Node.js dependencies that will be needed
echo "📦 Installing Node.js and tools..."

# Create the MCP project
echo "🔧 Creating MCP project with dependencies..."
npx create-mcp-use-app mcp-project --template starter --install --yes

# Verify project was created
if [ ! -d "mcp-project" ]; then
    echo "❌ Failed to create MCP project"
    exit 1
fi

echo "✅ MCP project created at mcp-project/"
ls -la mcp-project/

# Install Infisical CLI
echo "🔐 Installing Infisical CLI..."
curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | sudo -E bash
sudo apt-get update && sudo apt-get install -y infisical

# Verify Infisical installation
if ! command -v infisical &> /dev/null; then
    echo "⚠️  Infisical not installed, but continuing..."
fi

# Create E2B template configuration
cat > e2b.Dockerfile <<'EOF'
# Use E2B base image with Node.js
FROM e2bdev/code-interpreter:latest

# Set working directory
WORKDIR /home/user

# Copy the pre-created MCP project
COPY mcp-project /home/user/mcp-project

# Set permissions
RUN chown -R user:user /home/user/mcp-project

# Pre-install Infisical CLI (if not already in base image)
RUN curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash && \
    apt-get update && apt-get install -y infisical || true

# Install Agent SDK and other dependencies globally for the sandbox agent runtime
RUN npm install -g tsx @anthropic-ai/claude-agent-sdk

USER user
WORKDIR /home/user
EOF

echo "📋 E2B Dockerfile created"

# Create build script for E2B
cat > build-template.sh <<'EOF'
#!/bin/bash
# Build and push E2B template
e2b template build --name "mcp-use-mango" --dockerfile e2b.Dockerfile
EOF

chmod +x build-template.sh

echo ""
echo "✅ E2B template setup complete!"
echo ""
echo "📍 Template directory: $TEMP_DIR"
echo ""
echo "To build and upload the template to E2B:"
echo "  cd $TEMP_DIR"
echo "  ./build-template.sh"
echo ""
echo "After uploading, save the template ID as E2B_TEMPLATE_ID in your environment"
echo ""
