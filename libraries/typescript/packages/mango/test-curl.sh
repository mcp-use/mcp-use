#!/bin/bash

# Test script for Mango Agent Chat API
# Make sure the server is running first: pnpm dev

echo "🧪 Testing Mango Agent Chat API..."
echo ""

# Test 1: Health check
echo "1. Testing health endpoint..."
curl -s http://localhost:3001/health | jq '.' || echo "❌ Health check failed"
echo ""
echo ""

# Test 2: Chat stream endpoint
echo "2. Testing chat stream endpoint..."
echo "Sending: {\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"conversationId\":\"test-$(date +%s)\"}"
echo ""
echo "Response (SSE stream):"
echo "---"
curl -N -X POST http://localhost:3001/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "hi"
      }
    ],
    "conversationId": "test-'$(date +%s)'"
  }' \
  --no-buffer \
  2>&1 | head -50
echo ""
echo "---"
echo ""
echo "✅ Test complete"

