import { bearerAuthMiddleware, createMCPServer } from 'mcp-use/server';

/**
 * Simple Bearer Token Authentication Example
 * 
 * This example shows basic API key/bearer token authentication.
 * Useful for simple scenarios or when integrating with custom token systems.
 * 
 * For production OAuth flows with Auth0/Keycloak, see the auth-oauth example.
 */

const server = createMCPServer('bearer-auth-server', {
  version: '1.0.0',
  description: 'MCP server with bearer token authentication'
});

// Simple bearer token authentication middleware
server.use(bearerAuthMiddleware(async (token) => {
  // In production, validate against your token store/database
  const validTokens = new Map([
    [process.env.API_KEY, { userId: 'admin', role: 'admin' }],
    [process.env.API_KEY_2, { userId: 'user', role: 'user' }],
  ].filter(([key]) => key));
  
  const user = validTokens.get(token);
  
  if (!user) {
    throw new Error('Invalid API key');
  }
  
  return user;
}));

// Protected tool that uses authentication context
server.tool({
  name: 'get-user-info',
  description: 'Get information about the authenticated user',
  inputs: [],
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          userId: user?.userId,
          role: user?.role,
          authenticated: !!user
        }, null, 2)
      }]
    };
  }
});

// Example tool with user context
server.tool({
  name: 'send-notification',
  description: 'Send a notification (requires authentication)',
  inputs: [
    { name: 'message', type: 'string', required: true },
    { name: 'priority', type: 'string', required: false }
  ],
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    // Simulate sending notification
    console.log(`[NOTIFICATION] User ${user?.userId} sent: ${params.message}`);
    
    return {
      content: [{
        type: 'text',
        text: `Notification sent by ${user?.userId}: "${params.message}"`
      }]
    };
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT).then(() => {
  console.log('='.repeat(60));
  console.log('Bearer Token Authentication Example');
  console.log('='.repeat(60));
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Inspector (no auth): http://localhost:${PORT}/inspector`);
  console.log('');
  console.log('Test with curl:');
  console.log(`  curl -H "Authorization: Bearer \${API_KEY}" \\`);
  console.log(`    http://localhost:${PORT}/mcp`);
  console.log('');
  console.log(`API Key: ${process.env.API_KEY || '(Set API_KEY env variable)'}`);
  console.log('='.repeat(60));
});

