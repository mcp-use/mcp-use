#!/bin/bash
set -e

echo "🔧 Patching package.json for Deno compatibility..."
# Create backup and patch
sed -i.bak 's|"@modelcontextprotocol/sdk": "https://pkg.pr.new/modelcontextprotocol/typescript-sdk/@modelcontextprotocol/sdk@1194"|"@modelcontextprotocol/sdk": "^1.23.0"|g' package.json

echo "📦 Packing mcp-use..."
pnpm pack

echo "🔄 Restoring original package.json..."
mv package.json.bak package.json

echo "📁 Setting up test directory..."
mkdir -p deno-test-temp
cd deno-test-temp

PACKAGE_FILE=$(ls ../mcp-use-*.tgz | head -1)
echo "Using package: $PACKAGE_FILE"

cat > package.json << EOF
{
  "type": "module",
  "dependencies": {
    "mcp-use": "file:$PACKAGE_FILE"
  }
}
EOF

echo "📥 Installing package..."
pnpm install

echo "🦕 Running Deno tests..."
deno test --no-check --node-modules-dir --allow-net --allow-read --allow-env ../tests/deno/basic-server.test.ts

cd ..
echo "🧹 Cleaning up..."
rm -rf deno-test-temp
rm -f mcp-use-*.tgz

echo "✅ Deno tests completed!"

