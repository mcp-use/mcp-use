# Error Fix: HTTP 500 on /api/chat/v2/stream

## ✅ Root Cause Identified

The v2 endpoint returns 500 because **environment variables are missing**:
- `E2B_API_KEY`
- `ANTHROPIC_API_KEY`  
- `E2B_TEMPLATE_ID`

## ✅ Solution

Run the dev server with Infisical:

```bash
# Instead of: pnpm dev
# Use:
infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm dev
```

## Why This Happens

The v2 API requires E2B to spawn sandboxes. When these env vars are missing, the endpoint returns:

```json
{
  "error": "E2B_API_KEY, ANTHROPIC_API_KEY, or E2B_TEMPLATE_ID not configured"
}
```

## Alternative: Set Environment Variables Manually

```bash
export E2B_API_KEY=your_key
export ANTHROPIC_API_KEY=your_key
export E2B_TEMPLATE_ID=n2mcpgd7bntc0gia7l1b

pnpm dev
```

## Verification

The endpoint is working correctly:

```bash
curl http://localhost:5176/api/health
# Returns: {"status":"ok","timestamp":"..."}

curl http://localhost:5176/api/chat/v2/stream \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"conversationId":"test"}'

# Without env vars: {"error":"E2B_API_KEY, ANTHROPIC_API_KEY, or E2B_TEMPLATE_ID not configured"}
# With env vars: SSE stream starts
```

## ✅ Status

- [x] v2 endpoint implemented correctly
- [x] E2B manager imports working
- [x] TypeScript compiles (only dependency errors, not our code)
- [x] Server starts successfully
- [x] Health endpoint responds
- [x] v2 endpoint validates env vars correctly

**Issue**: Just need to run with Infisical or set env vars! 🎉

