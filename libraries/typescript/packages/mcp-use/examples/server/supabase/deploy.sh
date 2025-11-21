#!/bin/bash

# Supabase MCP-USE Deployment Script
# This script automates the deployment of an mcp-use app to Supabase Edge Functions

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
FUNCTION_NAME="${2:-mcp-server}"
BUCKET_NAME="${3:-widgets}"
PROJECT_ID="$1"

# Help function
show_help() {
    echo -e "${BLUE}Supabase MCP-USE Deployment Script${NC}"
    echo ""
    echo "Usage: ./deploy.sh <project-id> [function-name] [bucket-name]"
    echo ""
    echo "Arguments:"
    echo "  project-id     : Your Supabase project ID (required)"
    echo "  function-name  : Name of the edge function (default: mcp-server)"
    echo "  bucket-name    : Name of the storage bucket (default: widgets)"
    echo ""
    echo "Example:"
    echo "  ./deploy.sh nnpumlykjksvxivhywwo"
    echo "  ./deploy.sh nnpumlykjksvxivhywwo my-mcp-function my-bucket"
    echo ""
}

# Print colored messages
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if project ID is provided
if [ -z "$PROJECT_ID" ]; then
    print_error "Project ID is required"
    echo ""
    show_help
    exit 1
fi

print_info "Starting deployment to Supabase..."
echo ""
print_info "Configuration:"
echo "  Project ID: $PROJECT_ID"
echo "  Function Name: $FUNCTION_NAME"
echo "  Bucket Name: $BUCKET_NAME"
echo ""

# Check if supabase CLI is installed
print_info "Checking for Supabase CLI..."
if ! command -v supabase &> /dev/null; then
    print_error "Supabase CLI is not installed"
    echo ""
    echo "Please install it using:"
    echo "  npm install -g supabase"
    echo "or visit: https://supabase.com/docs/guides/cli"
    exit 1
fi
print_success "Supabase CLI found"

# Check if supabase is initialized
print_info "Checking if Supabase is initialized..."
if [ ! -f "supabase/config.toml" ]; then
    print_error "Supabase is not initialized in this directory"
    echo ""
    echo "Please run: supabase init"
    exit 1
fi
print_success "Supabase is initialized"

# Check if user is logged in
print_info "Checking Supabase authentication..."
if ! supabase projects list &> /dev/null; then
    print_error "You are not logged in to Supabase"
    echo ""
    echo "Please run: supabase login"
    exit 1
fi
print_success "Authenticated with Supabase"

# Check if project is linked
print_info "Checking if project is linked..."
LINKED_PROJECT=$(supabase status 2>&1 | grep "Project ID" | awk '{print $NF}' || echo "")
if [ -z "$LINKED_PROJECT" ]; then
    print_warning "Project not linked. Linking to project: $PROJECT_ID"
    if ! supabase link --project-ref "$PROJECT_ID"; then
        print_error "Failed to link to project $PROJECT_ID"
        exit 1
    fi
    print_success "Linked to project $PROJECT_ID"
else
    print_success "Project already linked: $LINKED_PROJECT"
    if [ "$LINKED_PROJECT" != "$PROJECT_ID" ]; then
        print_warning "Linked project ($LINKED_PROJECT) differs from specified project ($PROJECT_ID)"
        read -p "Continue with linked project? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Relinking to $PROJECT_ID..."
            supabase unlink
            supabase link --project-ref "$PROJECT_ID"
            print_success "Relinked to project $PROJECT_ID"
        fi
    fi
fi

# Check for package manager
print_info "Detecting package manager..."
if [ -f "pnpm-lock.yaml" ]; then
    PKG_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
    PKG_MANAGER="yarn"
elif [ -f "package-lock.json" ]; then
    PKG_MANAGER="npm"
else
    print_warning "No lock file found, defaulting to npm"
    PKG_MANAGER="npm"
fi
print_success "Using package manager: $PKG_MANAGER"

# Patch config.toml
print_info "Patching supabase/config.toml..."
if [ -f "supabase/config.toml" ]; then
    # Update project_id in config.toml
    if grep -q "^project_id = " supabase/config.toml; then
        # Use different delimiters for sed to avoid conflicts with slashes
        sed -i.bak "s|^project_id = .*|project_id = \"$PROJECT_ID\"|g" supabase/config.toml
        rm -f supabase/config.toml.bak
        print_success "Updated project_id in config.toml"
    else
        print_warning "project_id not found in config.toml, skipping..."
    fi
    
    # Ensure [functions.<function-name>] section exists and is properly configured
    if ! grep -q "\[functions.$FUNCTION_NAME\]" supabase/config.toml; then
        print_warning "Function configuration not found in config.toml"
        echo "" >> supabase/config.toml
        echo "[functions.$FUNCTION_NAME]" >> supabase/config.toml
        echo "verify_jwt = false" >> supabase/config.toml
        echo "static_files = [ \"./functions/$FUNCTION_NAME/dist/**/*.html\", \"./functions/$FUNCTION_NAME/dist/mcp-use.json\" ]" >> supabase/config.toml
        print_success "Added function configuration to config.toml"
    fi
else
    print_error "supabase/config.toml not found"
    exit 1
fi

# Build the project
print_info "Building the project..."
MCP_URL="https://${PROJECT_ID}.supabase.co/storage/v1/object/public/${BUCKET_NAME}"
export MCP_URL
print_info "Using MCP_URL: $MCP_URL"

if ! $PKG_MANAGER run build; then
    print_error "Build failed"
    exit 1
fi
print_success "Build completed successfully"

# Check if dist directory exists
if [ ! -d "dist" ]; then
    print_error "dist directory not found after build"
    exit 1
fi

# Create function directory structure
print_info "Setting up function directory structure..."
FUNCTION_DIR="supabase/functions/$FUNCTION_NAME"
mkdir -p "$FUNCTION_DIR"
print_success "Created $FUNCTION_DIR"

# Copy dist to function directory
print_info "Copying build artifacts..."
if [ -d "$FUNCTION_DIR/dist" ]; then
    rm -rf "$FUNCTION_DIR/dist"
fi
cp -r dist "$FUNCTION_DIR/"
print_success "Copied dist to $FUNCTION_DIR"

# Check if index.ts exists, if not copy from current root
if [ ! -f "$FUNCTION_DIR/index.ts" ]; then
    print_warning "index.ts not found in $FUNCTION_DIR"
    
    # Check if we have index.ts in the current root
    if [ -f "index.ts" ]; then
        print_info "Copying index.ts from current root..."
        cp "index.ts" "$FUNCTION_DIR/"
        
        # Update PROJECT_REF in index.ts
        sed -i.bak "s/nnpumlykjksvxivhywwo/$PROJECT_ID/g" "$FUNCTION_DIR/index.ts"
        rm -f "$FUNCTION_DIR/index.ts.bak"
        print_success "Copied and updated index.ts"
    else
        print_error "No index.ts found"
        echo ""
        echo "Please ensure you have an index.ts file in the current root directory"
        exit 1
    fi
fi

# Check for deno.json and populate with mcp-use dependency
if [ ! -f "$FUNCTION_DIR/deno.json" ]; then
    print_info "Creating deno.json with mcp-use dependency..."
    cat > "$FUNCTION_DIR/deno.json" << 'EOF'
{
  "imports": {
    "mcp-use/": "https://esm.sh/mcp-use@canary/"
  }
}
EOF
    print_success "Created deno.json with mcp-use dependency"
else
    # Update existing deno.json to include mcp-use dependency if not already present
    if ! grep -q "mcp-use" "$FUNCTION_DIR/deno.json"; then
        print_info "Updating deno.json with mcp-use dependency..."
        # Use a temporary file for safer JSON manipulation
        if command -v jq &> /dev/null; then
            # Use jq if available for proper JSON handling
            jq '.imports."mcp-use/" = "https://esm.sh/mcp-use@canary/"' "$FUNCTION_DIR/deno.json" > "$FUNCTION_DIR/deno.json.tmp"
            mv "$FUNCTION_DIR/deno.json.tmp" "$FUNCTION_DIR/deno.json"
            print_success "Updated deno.json with mcp-use dependency"
        else
            print_warning "jq not found, skipping deno.json update. Please manually add mcp-use dependency."
        fi
    fi
fi

# Deploy the function
print_info "Deploying function to Supabase..."
if ! supabase functions deploy "$FUNCTION_NAME" --use-docker; then
    print_error "Function deployment failed"
    exit 1
fi
print_success "Function deployed successfully"

# Upload widgets to storage
if [ -d "dist/resources/widgets" ]; then
    print_info "Uploading widgets to storage bucket: $BUCKET_NAME"
    
    # Upload widgets to storage
    if supabase storage cp -r dist/resources/widgets "ss:///${BUCKET_NAME}/" --experimental 2>&1; then
        print_success "Widgets uploaded successfully"
        
        # Important: The bucket must be public for widgets to be accessible
        echo ""
        print_warning "The storage bucket needs to be set to PUBLIC for widgets to be accessible"
        echo ""
        echo "Please follow these steps:"
        echo -e "  1. Go to: ${BLUE}https://supabase.com/dashboard/project/$PROJECT_ID/storage/files/buckets/$BUCKET_NAME${NC}"
        echo "  2. Click on the bucket settings (gear icon)"
        echo -e "  3. Find 'Bucket Settings' and toggle '${BLUE}Public${NC}' ON"
        echo "  4. Save the changes"
        echo ""
        read -p "Press ENTER once you've made the bucket public..." -r
        echo ""
    else
        print_warning "Widget upload failed"
        echo "You may need to create the bucket first or check your permissions"
    fi
else
    print_warning "No widgets directory found at dist/resources/widgets"
    echo "Skipping widget upload..."
fi

# Print deployment summary
echo ""
print_success "========================================="
print_success "Deployment completed successfully!"
print_success "========================================="
echo ""

# Calculate the MCP endpoint and inspector URL
MCP_ENDPOINT="https://${PROJECT_ID}.supabase.co/functions/v1/${FUNCTION_NAME}/mcp"
INSPECTOR_URL="https://inspector.mcp-use.com/inspector?autoConnect=$(echo -n "$MCP_ENDPOINT" | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))')"

print_info "MCP Endpoint:"
echo "  $MCP_ENDPOINT"
echo ""
print_info "Inspector:"
echo "  $INSPECTOR_URL"
echo ""
echo ""

