#!/bin/bash

# E2B Template Creation Script for Mango
# This script creates an E2B template with pre-installed mcp-use project (apps-sdk template)

set -e  # Exit on error

echo "🚀 Creating E2B template for Mango with apps-sdk..."
echo ""

# Check if e2b CLI is installed
if ! command -v e2b &> /dev/null; then
    echo "❌ E2B CLI not found. Installing..."
    npm install -g @e2b/cli
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE_PATH="$SCRIPT_DIR/e2b.Dockerfile"

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE_PATH" ]; then
    echo "❌ Dockerfile not found at: $DOCKERFILE_PATH"
    exit 1
fi

echo "📋 Configuration:"
echo "   Dockerfile: $DOCKERFILE_PATH"
echo ""

# Build E2B template
echo "🔨 Building E2B template..."
echo ""

# e2b expects relative path, so cd to the directory first
cd "$SCRIPT_DIR"

e2b template build \
  --name "mcp-use-mango-apps-sdk" \
  --dockerfile "e2b.Dockerfile"

echo ""
echo "✅ E2B template created successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Copy the template ID from the output above"
echo "2. Update .env file: E2B_TEMPLATE_ID=<your-template-id>"
echo "3. Restart mango server: pnpm dev"
echo ""

