# Bearer Token Authentication Example

Simple API key / bearer token authentication for MCP servers.

## Overview

This example demonstrates:
- Basic bearer token validation
- Authentication context in tool callbacks
- Inspector UI accessible without authentication
- Clear error messages for auth failures

## When to Use

- Simple API key authentication
- Internal tools/services
- Development and testing
- When you control token generation

For production OAuth flows with Auth0/Keycloak, see the `auth-oauth` example.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Generate a secure API key:
```bash
# On macOS/Linux
openssl rand -hex 32

# Or use any secure random string
```

4. Update `.env` with your API key:
```env
API_KEY=your-generated-api-key-here
PORT=3000
```

## Running

Development mode:
```bash
pnpm dev
```

Production mode:
```bash
pnpm build
pnpm start
```

## Testing

### Test without authentication (should fail):
```bash
curl http://localhost:3000/mcp
```

Response:
```json
{
  "error": "Missing Authorization header",
  "hint": "Include header: Authorization: Bearer YOUR_API_KEY"
}
```

### Test with invalid token (should fail):
```bash
curl -H "Authorization: Bearer invalid-token" http://localhost:3000/mcp
```

Response:
```json
{
  "error": "Invalid API key",
  "hint": "Check your API_KEY environment variable"
}
```

### Test with valid token (should work):
```bash
curl -H "Authorization: Bearer your-generated-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  http://localhost:3000/mcp
```

### Test Inspector UI (no auth required):
```bash
open http://localhost:3000/inspector
```

## Using with MCP Inspector

1. Start the server:
```bash
pnpm dev
```

2. Open Inspector:
```
http://localhost:3000/inspector
```

3. Configure authentication in Inspector:
   - Go to Settings → Authentication
   - Select "Bearer Token"
   - Enter your API key
   - Test connection

## Integration Example

```typescript
import { BrowserMCPClient } from 'mcp-use';

const client = new BrowserMCPClient({
  'my-server': {
    url: 'http://localhost:3000/mcp',
    headers: {
      'Authorization': 'Bearer your-api-key-here'
    }
  }
});

await client.connect('my-server');
const tools = await client.listTools('my-server');
```

## Code Structure

```typescript
// Authentication middleware
server.use((req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader.replace(/^Bearer\s+/i, '');
  
  // Validate token
  if (!validTokens.has(token)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Store user context
  req.userId = 'user-id';
  next();
});

// Tool with authentication context
server.tool({
  name: 'my-tool',
  cb: async (params, context) => {
    const userId = context?.req?.userId;
    // Use userId for user-specific operations
  }
});
```

## Security Best Practices

1. **Never commit API keys to version control**
   - Use `.env` files (gitignored)
   - Use environment variables in production

2. **Use HTTPS in production**
   ```typescript
   // Behind a reverse proxy (nginx, Caddy)
   server.listen(3000, () => {
     console.log('Server ready (use HTTPS in production)');
   });
   ```

3. **Rotate keys regularly**
   - Generate new keys periodically
   - Support multiple active keys during rotation

4. **Rate limiting**
   ```bash
   pnpm add express-rate-limit
   ```
   ```typescript
   import rateLimit from 'express-rate-limit';
   
   server.use(rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100 // limit each key to 100 requests per window
   }));
   ```

5. **Token storage**
   - Store tokens hashed in database
   - Use bcrypt or similar for hashing
   - Never log full tokens

## Next Steps

- See `auth-jwt` example for JWT authentication with Auth0/Keycloak
- See `auth-oauth` example for full OAuth 2.0 integration
- Read [Authentication Guide](../../../docs/typescript/server/authentication.mdx)

