#!/bin/bash
set -e

echo "🚀 Setting up MCP-Use development environment..."

# Install UV (Python package manager)
echo "📦 Installing UV for Python package management..."
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.cargo/bin:$PATH"

# Setup Python environment
echo "🐍 Setting up Python environment..."
if [ -d "/workspace/libraries/python" ]; then
    cd /workspace/libraries/python

    # Install Python dependencies if pyproject.toml exists
    if [ -f "pyproject.toml" ]; then
        echo "Installing Python dependencies..."
        uv pip install --system -e ".[dev]" 2>/dev/null || uv pip install --system -e . 2>/dev/null || echo "Python dependencies installation skipped"
    fi
fi

# Setup TypeScript/Node.js environment
echo "📘 Setting up TypeScript/Node.js environment..."
cd /workspace

# Check if this is a pnpm workspace
if [ -f "pnpm-workspace.yaml" ] || [ -f "pnpm-lock.yaml" ]; then
    echo "Detected pnpm workspace, installing pnpm..."
    npm install -g pnpm
    
    echo "Installing dependencies with pnpm..."
    pnpm install 2>/dev/null || echo "pnpm install completed with warnings"
    
elif [ -f "package.json" ]; then
    # Check if it's an npm workspace
    if grep -q '"workspaces"' package.json 2>/dev/null; then
        echo "Detected npm workspace..."
        echo "Installing workspace dependencies from root..."
        npm install 2>/dev/null || echo "npm workspace install completed with warnings"
    else
        echo "Installing root dependencies..."
        npm install 2>/dev/null || echo "Root npm install skipped"
        
        # Install TypeScript packages individually
        if [ -d "/workspace/libraries/typescript" ]; then
            cd /workspace/libraries/typescript
            if [ -f "package.json" ]; then
                echo "Installing TypeScript library dependencies..."
                npm install 2>/dev/null || echo "TypeScript npm install skipped"
            fi
        fi
    fi
fi

# Build TypeScript packages if needed
if [ -d "/workspace/libraries/typescript" ] && [ -f "/workspace/libraries/typescript/tsconfig.json" ]; then
    cd /workspace/libraries/typescript
    echo "Building TypeScript packages..."
    npm run build 2>/dev/null || pnpm run build 2>/dev/null || echo "Build script not found, skipping..."
fi

# Setup MCP packages
echo "🔧 Setting up MCP packages..."
if [ -d "/workspace/libraries/typescript/packages" ]; then
    cd /workspace/libraries/typescript/packages

    # Install dependencies for each package
    for package_dir in */; do
        if [ -d "$package_dir" ] && [ -f "${package_dir}package.json" ]; then
            echo "Setting up package: $package_dir"
            cd "$package_dir"
            npm install 2>/dev/null || echo "Failed to install dependencies for $package_dir"
            cd ..
        fi
    done
fi

# Return to workspace root
cd /workspace

# Create example environment file if it doesn't exist
if [ ! -f ".env" ] && [ ! -f ".env.example" ]; then
    echo "📝 Creating example .env file..."
    cat > .env.example << 'EOF'
# API Keys for MCP Agents
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# UV Python package index (optional)
UV_INDEX=

# Development settings
NODE_ENV=development
EOF
    echo "Created .env.example - Copy to .env and add your API keys"
fi

# Set up Git hooks if pre-commit is available
if command -v pre-commit &> /dev/null; then
    echo "⚙️ Setting up pre-commit hooks..."
    pre-commit install || echo "Pre-commit installation skipped"
fi

# Display helpful information
echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Project structure:"
echo "  - /workspace/libraries/python    - Python implementation"
echo "  - /workspace/libraries/typescript - TypeScript implementation"
echo ""
echo "🔥 Quick start commands:"
echo "  Python:"
echo "    cd libraries/python"
echo "    uv run examples/quickstart.py"
echo ""
echo "  TypeScript:"
echo "    cd libraries/typescript"
echo "    npm run dev"
echo ""
echo "  Inspector (for debugging MCP servers):"
echo "    npm run inspector"
echo ""
echo "💡 Don't forget to:"
echo "  1. Copy .env.example to .env"
echo "  2. Add your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)"
echo "  3. Review the README.md for more details"
echo ""
