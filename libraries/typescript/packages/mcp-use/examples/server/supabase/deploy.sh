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

# Check if Docker is running
check_docker_running() {
    if docker info > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Check if project has widgets
has_widgets() {
    local resources_dir="resources"
    
    # Check if resources directory exists
    if [ ! -d "$resources_dir" ]; then
        return 1
    fi
    
    # Check for widget files: *.tsx, *.ts files directly in resources/, or widget.tsx in subdirectories
    # Exclude macOS resource fork files and hidden files
    for item in "$resources_dir"/*; do
        # Skip if no matches found (glob expansion)
        [ -e "$item" ] || continue
        
        local basename=$(basename "$item")
        
        # Skip hidden/system files
        if [[ "$basename" =~ ^\._ ]] || [[ "$basename" == ".DS_Store" ]]; then
            continue
        fi
        
        # Check if it's a file with .tsx or .ts extension
        if [ -f "$item" ] && [[ "$basename" =~ \.(tsx|ts)$ ]]; then
            return 0
        fi
        
        # Check if it's a directory with widget.tsx inside
        if [ -d "$item" ] && [ -f "$item/widget.tsx" ]; then
            return 0
        fi
    done
    
    return 1
}

# Help function
show_help() {
    echo -e "${BLUE}Supabase MCP-USE Deployment Script${NC}"
    echo ""
    echo "Usage: ./deploy.sh [project-id] [function-name] [bucket-name] [--version VERSION]"
    echo ""
    echo "Arguments (optional if run interactively):"
    echo "  project-id     : Your Supabase project ID"
    echo "  function-name  : Name of the edge function (default: mcp-server)"
    echo "  bucket-name    : Name of the storage bucket (default: widgets)"
    echo ""
    echo "Flags:"
    echo "  --version      : Specify mcp-use version (default: latest)"
    echo "                   Examples: latest, canary, 1.5.1, 1.5.1.canary.3"
    echo ""
    echo "Examples:"
    echo "  ./deploy.sh                                                    # Interactive mode"
    echo "  ./deploy.sh nnpumlykjksvxivhywwo                              # With project ID"
    echo "  ./deploy.sh nnpumlykjksvxivhywwo my-function                  # With custom function name"
    echo "  ./deploy.sh nnpumlykjksvxivhywwo mcp-server widgets --version canary           # Use canary version"
    echo "  ./deploy.sh nnpumlykjksvxivhywwo mcp-server widgets --version 1.5.1.canary.3   # Use specific version"
    echo ""
}

# Parse flags and arguments
MCP_USE_VERSION="1.10.6"
PROJECT_ID=""
FUNCTION_NAME=""
BUCKET_NAME=""
NEXT_IS_VERSION=false

for arg in "$@"; do
    if [ "$NEXT_IS_VERSION" = true ]; then
        MCP_USE_VERSION="$arg"
        NEXT_IS_VERSION=false
    elif [ "$arg" = "--version" ]; then
        NEXT_IS_VERSION=true
    elif [ -z "$PROJECT_ID" ]; then
        PROJECT_ID="$arg"
    elif [ -z "$FUNCTION_NAME" ]; then
        FUNCTION_NAME="$arg"
    elif [ -z "$BUCKET_NAME" ]; then
        BUCKET_NAME="$arg"
    fi
done

# Interactive prompts if arguments not provided
echo -e "${BLUE}Supabase MCP-USE Deployment Script${NC}"
echo ""

# Prompt for project ID if not provided
if [ -z "$PROJECT_ID" ]; then
    read -p "Enter your Supabase project ID: " PROJECT_ID </dev/tty
    if [ -z "$PROJECT_ID" ]; then
        print_error "Project ID is required"
        exit 1
    fi
fi

# Prompt for function name if not provided
if [ -z "$FUNCTION_NAME" ]; then
    read -p "Enter function name (default: mcp-server): " FUNCTION_NAME </dev/tty
    FUNCTION_NAME="${FUNCTION_NAME:-mcp-server}"
fi

# Prompt for bucket name if not provided
if [ -z "$BUCKET_NAME" ]; then
    read -p "Enter bucket name (default: widgets): " BUCKET_NAME </dev/tty
    BUCKET_NAME="${BUCKET_NAME:-widgets}"
fi

print_info "Starting deployment to Supabase..."
echo ""
print_info "Configuration:"
echo "  Project ID: $PROJECT_ID"
echo "  Function Name: $FUNCTION_NAME"
echo "  Bucket Name: $BUCKET_NAME"
echo "  MCP-USE Version: @$MCP_USE_VERSION"
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

# Check Docker if project has widgets
if has_widgets; then
    print_info "Widgets detected, checking Docker..."
    if ! check_docker_running; then
        print_error "Docker is required for widgets data. Please start Docker and try again."
        exit 1
    fi
    print_success "Docker is running"
fi

# Check if project is linked
print_info "Checking if project is linked..."
LINKED_PROJECT=""
if [ -f "supabase/config.toml" ]; then
    LINKED_PROJECT=$(grep "^project_id = " supabase/config.toml | sed 's/project_id = "\(.*\)"/\1/' | tr -d '"' || echo "")
fi

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
        
        # Check if linked project looks like a valid Supabase project ref (20 chars alphanumeric)
        if [[ ! "$LINKED_PROJECT" =~ ^[a-z0-9]{20}$ ]]; then
            print_warning "Linked project ID '$LINKED_PROJECT' doesn't look like a valid Supabase project ref"
            print_info "Relinking to $PROJECT_ID..."
            supabase unlink
            supabase link --project-ref "$PROJECT_ID"
            print_success "Relinked to project $PROJECT_ID"
        else
            read -p "Continue with linked project? (y/N): " -n 1 -r </dev/tty
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # User wants to continue with the linked project, so use it
                print_info "Using linked project: $LINKED_PROJECT"
                PROJECT_ID="$LINKED_PROJECT"
            else
                print_info "Relinking to $PROJECT_ID..."
                supabase unlink
                supabase link --project-ref "$PROJECT_ID"
                print_success "Relinked to project $PROJECT_ID"
            fi
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
        echo "static_files = [ \"./functions/$FUNCTION_NAME/dist/**/*.html\", \"./functions/$FUNCTION_NAME/dist/mcp-use.json\", \"./functions/$FUNCTION_NAME/dist/public/**/*\" ]" >> supabase/config.toml
        print_success "Added function configuration to config.toml"
    fi
else
    print_error "supabase/config.toml not found"
    exit 1
fi

# Build the project
print_info "Building the project..."
# MCP_URL: Where widget assets (JS/CSS) are stored (storage bucket)
MCP_URL="https://${PROJECT_ID}.supabase.co/storage/v1/object/public/${BUCKET_NAME}"
export MCP_URL
print_info "Using MCP_URL: $MCP_URL"

# MCP_SERVER_URL: Where the MCP server runs (edge function) for API calls
MCP_SERVER_URL="https://${PROJECT_ID}.supabase.co/functions/v1/${FUNCTION_NAME}"
export MCP_SERVER_URL
print_info "Using MCP_SERVER_URL: $MCP_SERVER_URL"

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

# Create/override deno.json with mcp-use dependency
print_info "Creating deno.json with mcp-use@$MCP_USE_VERSION dependency..."
cat > "$FUNCTION_DIR/deno.json" << EOF
{
  "imports": {
    "mcp-use/client": "https://esm.sh/pr/mcp-use/mcp-use@679/client",
    "mcp-use/server": "https://esm.sh/pr/mcp-use/mcp-use@679/server",
    "zod/v4": "https://esm.sh/zod@4/v4"
  }
}

EOF
print_success "Created deno.json with mcp-use@$MCP_USE_VERSION dependency"

# Set environment variables BEFORE deploying the function
print_info "Setting environment variables for edge function..."
FUNCTION_BASE_URL="https://${PROJECT_ID}.supabase.co/functions/v1/${FUNCTION_NAME}"
CSP_URLS="https://${PROJECT_ID}.supabase.co"

# Set MCP_URL
if supabase secrets set MCP_URL="$FUNCTION_BASE_URL" --project-ref "$PROJECT_ID"; then
    print_success "MCP_URL environment variable set to: $FUNCTION_BASE_URL"
else
    print_warning "Failed to set MCP_URL environment variable"
fi

# Set CSP_URLS to allow widget assets from storage bucket
if supabase secrets set CSP_URLS="$CSP_URLS" --project-ref "$PROJECT_ID"; then
    print_success "CSP_URLS environment variable set to: $CSP_URLS"
else
    print_warning "Failed to set CSP_URLS environment variable"
fi

# Deploy the function (will pick up the environment variables set above)
print_info "Deploying function to Supabase..."
if ! supabase functions deploy "$FUNCTION_NAME" --use-docker; then
    print_error "Function deployment failed"
    exit 1
fi
print_success "Function deployed successfully"

# Upload widgets to storage
if [ -d "dist/resources/widgets" ]; then
    print_info "Uploading widgets to storage bucket: $BUCKET_NAME"
    
    # Upload widgets to storage (upload contents, not the folder itself)
    if supabase storage cp -r dist/resources/widgets/ "ss:///${BUCKET_NAME}/" --experimental 2>&1; then
        print_success "Widgets uploaded successfully"
        
        # Important: The bucket must be public for widgets to be accessible
        echo ""
        print_warning "The storage bucket needs to be set to PUBLIC for widgets to be accessible"
        echo ""
        echo "Please follow these steps:"
        echo -e "  1. Go to: ${BLUE}https://supabase.com/dashboard/project/$PROJECT_ID/storage/files/buckets/$BUCKET_NAME${NC}?edit=true"
        echo "  2. Click on the bucket settings (gear icon)"
        echo -e "  3. Find 'Bucket Settings' and toggle '${BLUE}Public${NC}' ON"
        echo "  4. Save the changes"
        echo ""
        read -p "Press ENTER once you've made the bucket public..." -r </dev/tty
        echo ""
    else
        print_warning "Widget upload failed"
        echo "You may need to create the bucket first or check your permissions"
    fi
else
    print_warning "No widgets directory found at dist/resources/widgets"
    echo "Skipping widget upload..."
fi

# Upload public files to storage
if [ -d "dist/public" ]; then
    print_info "Uploading public files to storage bucket: $BUCKET_NAME"
    
    if supabase storage cp -r dist/public "ss:///${BUCKET_NAME}/public/" --experimental 2>&1; then
        print_success "Public files uploaded successfully"
    else
        print_warning "Public file upload failed"
        echo "You may need to check your bucket permissions"
    fi
else
    print_warning "No public directory found at dist/public"
    echo "Skipping public files upload..."
fi

# Calculate URLs
MCP_ENDPOINT="https://${PROJECT_ID}.supabase.co/functions/v1/${FUNCTION_NAME}/mcp"
FUNCTION_DASHBOARD="https://supabase.com/dashboard/project/${PROJECT_ID}/functions/${FUNCTION_NAME}"
INSPECTOR_URL="https://inspector.mcp-use.com/inspector?autoConnect=$(echo -n "$MCP_ENDPOINT" | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))')"

# Wait for the MCP server to be ready
echo ""
print_info "Waiting for MCP server to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
RETRY_DELAY=2

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Check if server responds (400, 406, or 200 are all valid "server is up" responses)
    RESPONSE=$(curl -s -w "\n%{http_code}" -m 5 "$MCP_ENDPOINT" 2>&1)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    # MCP server can return:
    # - 400: Bad request (server is up but rejecting the request format)
    # - 406: Not Acceptable (expects text/event-stream header)
    # - 200: Success
    # All indicate the server is functioning
    if [ "$HTTP_CODE" = "400" ]; then
        print_success "MCP server is up and running!"
        break
    elif [ "$HTTP_CODE" = "406" ] && echo "$BODY" | grep -q "text/event-stream"; then
        print_success "MCP server is up and running!"
        break
    elif [ "$HTTP_CODE" = "200" ]; then
        print_success "MCP server is up and running!"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo -n "."
        sleep $RETRY_DELAY
    else
        echo ""
        print_warning "Server didn't respond after ${MAX_RETRIES} attempts, but deployment completed"
        print_warning "It may take a few more moments to become available"
    fi
done
echo ""

# Print deployment summary
echo ""
print_success "========================================="
print_success "Deployment completed successfully!"
print_success "========================================="
echo ""

print_info "MCP Endpoint:"
echo "  $MCP_ENDPOINT"
echo ""
print_info "Function Dashboard:"
echo "  $FUNCTION_DASHBOARD"
echo ""
print_info "Inspector:"
echo "  $INSPECTOR_URL"
echo ""
echo ""

