#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 MCP Conformance Test Runner${NC}"
echo "================================"

# Create results directory
mkdir -p conformance-results

# Track PIDs for cleanup
PYTHON_PID=""
TS_PID=""

# Cleanup function
cleanup() {
  echo ""
  echo -e "${YELLOW}🧹 Cleaning up servers...${NC}"
  if [ -n "$PYTHON_PID" ]; then
    kill $PYTHON_PID 2>/dev/null || true
    echo "Stopped Python server (PID: $PYTHON_PID)"
  fi
  if [ -n "$TS_PID" ]; then
    kill $TS_PID 2>/dev/null || true
    echo "Stopped TypeScript server (PID: $TS_PID)"
  fi
}

# Set up cleanup trap
trap cleanup EXIT INT TERM

# ==============================================================================
# Python Server Setup
# ==============================================================================

PYTHON_URL=""
if [ -n "$PYTHON_SERVER_PATH" ]; then
  echo ""
  echo -e "${BLUE}📦 Setting up Python server${NC}"
  
  # Install dependencies if command provided
  if [ -n "$PYTHON_INSTALL_CMD" ]; then
    echo "Installing Python dependencies..."
    cd "$PYTHON_WORKING_DIR"
    eval "$PYTHON_INSTALL_CMD"
    cd - > /dev/null
  fi
  
  # Start Python server
  echo "Starting Python server from: $PYTHON_SERVER_PATH"
  cd "$PYTHON_WORKING_DIR"
  
  # Determine how to run the Python server
  if [[ "$PYTHON_SERVER_PATH" == *.py ]]; then
    python "$PYTHON_SERVER_PATH" --transport streamable-http --port "$PYTHON_SERVER_PORT" > conformance-results/python-server.log 2>&1 &
    PYTHON_PID=$!
  else
    # Assume it's a module or command
    eval "$PYTHON_SERVER_PATH --transport streamable-http --port $PYTHON_SERVER_PORT" > conformance-results/python-server.log 2>&1 &
    PYTHON_PID=$!
  fi
  
  cd - > /dev/null
  echo "Python server started (PID: $PYTHON_PID)"
  
  # Wait for server to be ready
  echo "Waiting for Python server to be ready..."
  for i in {1..30}; do
    if curl -s "http://127.0.0.1:$PYTHON_SERVER_PORT/mcp" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Python server is ready${NC}"
      PYTHON_URL="http://127.0.0.1:$PYTHON_SERVER_PORT/mcp"
      break
    fi
    if [ $i -eq 30 ]; then
      echo -e "${RED}✗ Python server failed to start${NC}"
      echo "Server log:"
      cat conformance-results/python-server.log || true
      exit 1
    fi
    sleep 1
  done
  
elif [ -n "$PYTHON_SERVER_URL" ]; then
  echo ""
  echo -e "${BLUE}🔗 Using existing Python server${NC}"
  PYTHON_URL="$PYTHON_SERVER_URL"
  
  # Verify server is accessible
  echo "Verifying Python server at: $PYTHON_URL"
  if curl -s "$PYTHON_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Python server is accessible${NC}"
  else
    echo -e "${RED}✗ Python server is not accessible${NC}"
    exit 1
  fi
fi

# ==============================================================================
# TypeScript Server Setup
# ==============================================================================

TS_URL=""
if [ -n "$TS_SERVER_PATH" ]; then
  echo ""
  echo -e "${BLUE}📦 Setting up TypeScript server${NC}"
  
  # Install dependencies if command provided
  if [ -n "$TS_INSTALL_CMD" ]; then
    echo "Installing TypeScript dependencies..."
    cd "$TS_WORKING_DIR"
    eval "$TS_INSTALL_CMD"
    cd - > /dev/null
  fi
  
  # Start TypeScript server
  echo "Starting TypeScript server from: $TS_SERVER_PATH"
  cd "$TS_WORKING_DIR"
  
  # Set port environment variable
  export PORT="$TS_SERVER_PORT"
  
  # Determine how to run the TypeScript server
  if [[ "$TS_SERVER_PATH" == *.ts ]]; then
    npx tsx "$TS_SERVER_PATH" > conformance-results/typescript-server.log 2>&1 &
    TS_PID=$!
  elif [[ "$TS_SERVER_PATH" == *.js ]]; then
    node "$TS_SERVER_PATH" > conformance-results/typescript-server.log 2>&1 &
    TS_PID=$!
  else
    # Assume it's a command
    eval "$TS_SERVER_PATH" > conformance-results/typescript-server.log 2>&1 &
    TS_PID=$!
  fi
  
  cd - > /dev/null
  echo "TypeScript server started (PID: $TS_PID)"
  
  # Wait for server to be ready
  echo "Waiting for TypeScript server to be ready..."
  for i in {1..30}; do
    if curl -s "http://localhost:$TS_SERVER_PORT/mcp" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ TypeScript server is ready${NC}"
      TS_URL="http://localhost:$TS_SERVER_PORT/mcp"
      break
    fi
    if [ $i -eq 30 ]; then
      echo -e "${RED}✗ TypeScript server failed to start${NC}"
      echo "Server log:"
      cat conformance-results/typescript-server.log || true
      exit 1
    fi
    sleep 1
  done
  
elif [ -n "$TS_SERVER_URL" ]; then
  echo ""
  echo -e "${BLUE}🔗 Using existing TypeScript server${NC}"
  TS_URL="$TS_SERVER_URL"
  
  # Verify server is accessible
  echo "Verifying TypeScript server at: $TS_URL"
  if curl -s "$TS_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ TypeScript server is accessible${NC}"
  else
    echo -e "${RED}✗ TypeScript server is not accessible${NC}"
    exit 1
  fi
fi

# ==============================================================================
# Run Conformance Tests
# ==============================================================================

echo ""
echo -e "${BLUE}🧪 Running Conformance Tests${NC}"
echo "================================"

# Run Python conformance tests
if [ -n "$PYTHON_URL" ]; then
  echo ""
  echo -e "${YELLOW}Testing Python server...${NC}"
  npx @modelcontextprotocol/conformance server --url "$PYTHON_URL" 2>&1 | tee conformance-results/python-conformance-output.txt
  echo ""
  echo -e "${GREEN}✓ Python conformance tests completed${NC}"
fi

# Run TypeScript conformance tests
if [ -n "$TS_URL" ]; then
  echo ""
  echo -e "${YELLOW}Testing TypeScript server...${NC}"
  npx @modelcontextprotocol/conformance server --url "$TS_URL" 2>&1 | tee conformance-results/typescript-conformance-output.txt
  echo ""
  echo -e "${GREEN}✓ TypeScript conformance tests completed${NC}"
fi

echo ""
echo -e "${GREEN}✅ All conformance tests completed${NC}"

