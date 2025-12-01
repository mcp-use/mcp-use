#!/bin/bash
set -e

echo "🦕 Running Deno tests with workspace version..."

# Patch package.json for Deno compatibility
echo "🔧 Patching package.json for Deno compatibility..."
sed -i.bak 's|"@modelcontextprotocol/sdk": "https://pkg.pr.new/modelcontextprotocol/typescript-sdk/@modelcontextprotocol/sdk@1194"|"@modelcontextprotocol/sdk": "^1.23.0"|g' package.json

# Pack the built package
echo "📦 Packing package..."
pnpm pack

# Restore original package.json
echo "🔄 Restoring original package.json..."
mv package.json.bak package.json

# Create temp test directory
echo "📁 Setting up test directory..."
rm -rf .deno-test-temp
mkdir -p .deno-test-temp
cd .deno-test-temp

# Find the tarball
PACKAGE_FILE=$(ls ../mcp-use-*.tgz | head -1)
echo "📦 Using package: $PACKAGE_FILE"

# Verify the tarball has the patched package.json
echo "🔍 Verifying tarball contents..."
tar -xzf "$PACKAGE_FILE" package/package.json
if grep -q "pkg.pr.new" package/package.json; then
  echo "❌ ERROR: Tarball still contains pkg.pr.new URL!"
  cat package/package.json | grep "@modelcontextprotocol/sdk"
  rm -rf package
  exit 1
fi
echo "✅ Tarball verified - using proper npm dependency"
rm -rf package

# Create package.json to install the local tarball
cat > package.json << EOF
{
  "type": "module",
  "dependencies": {
    "mcp-use": "file:$PACKAGE_FILE"
  }
}
EOF

# Install the local package
echo "📥 Installing package..."
pnpm install --no-frozen-lockfile

# Run Deno tests
echo "🧪 Running Deno tests..."
deno test --no-check --node-modules-dir --allow-net --allow-read --allow-env --config ../tests/deno/deno.json ../tests/deno/basic-server.test.ts

# Cleanup
cd ..
echo "🧹 Cleaning up..."
rm -rf .deno-test-temp
rm -f mcp-use-*.tgz

echo "✅ Deno tests passed!"

