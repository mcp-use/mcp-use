import { createMCPServer, oidcAuthMiddleware } from 'mcp-use/server';
import { setupDiscoveryEndpoints } from './discovery-endpoints.js';

/**
 * OAuth 2.0 Authentication Example with Auth0 & Keycloak
 * 
 * This example shows full OAuth 2.0 integration aligned with the MCP Protocol
 * Draft Specification, including:
 * - OpenID Connect Discovery 1.0 (SEP-797)
 * - WWW-Authenticate header with scope information (SEP-835)
 * - OAuth 2.0 Protected Resource Metadata (RFC 9728, SEP-985)
 * - Automatic token validation using JWKS
 * 
 * This allows MCP clients to automatically discover and authenticate with
 * your server using OAuth providers like Auth0 or Keycloak.
 */

const server = createMCPServer('oauth-mcp-server', {
  version: '1.0.0',
  description: 'MCP server with OAuth 2.0 authentication (Auth0/Keycloak)'
});

// Setup OAuth discovery endpoints (.well-known)
// This enables MCP clients to automatically discover OAuth configuration
setupDiscoveryEndpoints(server);

// Add OAuth authentication middleware
// This validates access tokens and returns WWW-Authenticate on 401
if (process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE) {
  server.use(oidcAuthMiddleware({
    issuer: process.env.OIDC_ISSUER,
    audience: process.env.OIDC_AUDIENCE,
    requiredScopes: ['mcp:read', 'mcp:write']
  }));
}

// Tool that returns user information
server.tool({
  name: 'whoami',
  description: 'Get information about the authenticated OAuth user',
  inputs: [],
  cb: async (params, context) => {
    const user = context?.req?.user;
    const scopes = context?.req?.scopes || [];
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          userId: user?.sub,
          email: user?.email,
          name: user?.name,
          scopes,
          provider: user?.iss?.includes('auth0') ? 'Auth0' : 
                   user?.iss?.includes('keycloak') ? 'Keycloak' : 'Unknown'
        }, null, 2)
      }]
    };
  }
});

// Tool requiring specific scope
server.tool({
  name: 'write-data',
  description: 'Write data (requires mcp:write scope)',
  inputs: [
    { name: 'data', type: 'string', required: true }
  ],
  cb: async (params, context) => {
    const scopes = context?.req?.scopes || [];
    
    if (!scopes.includes('mcp:write')) {
      throw new Error('Insufficient scope. Required: mcp:write');
    }
    
    console.log('[WRITE] Data written:', params.data);
    
    return {
      content: [{
        type: 'text',
        text: `Data written successfully: ${params.data}`
      }]
    };
  }
});

// Tool for admin operations
server.tool({
  name: 'admin-operation',
  description: 'Perform admin operation (requires admin scope)',
  inputs: [
    { name: 'operation', type: 'string', required: true }
  ],
  cb: async (params, context) => {
    const scopes = context?.req?.scopes || [];
    const roles = context?.req?.user?.roles || [];
    
    const isAdmin = scopes.includes('admin') || roles.includes('admin');
    
    if (!isAdmin) {
      throw new Error('Insufficient permissions. Admin access required.');
    }
    
    console.log('[ADMIN] Operation:', params.operation);
    
    return {
      content: [{
        type: 'text',
        text: `Admin operation "${params.operation}" completed`
      }]
    };
  }
});

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || 'localhost';
const BASE_URL = process.env.BASE_URL || `http://${HOST}:${PORT}`;

server.listen(PORT).then(() => {
  console.log('='.repeat(70));
  console.log('OAuth 2.0 Authentication Example (Auth0 & Keycloak)');
  console.log('='.repeat(70));
  console.log(`Server running on ${BASE_URL}`);
  console.log(`MCP endpoint: ${BASE_URL}/mcp`);
  console.log(`Inspector (no auth): ${BASE_URL}/inspector`);
  console.log('');
  console.log('OAuth Discovery Endpoints:');
  console.log(`  ${BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`  ${BASE_URL}/.well-known/openid-configuration`);
  console.log('');
  console.log('Configured providers:');
  if (process.env.AUTH0_DOMAIN) {
    console.log(`  ✓ Auth0: ${process.env.AUTH0_DOMAIN}`);
  }
  if (process.env.KEYCLOAK_SERVER_URL) {
    console.log(`  ✓ Keycloak: ${process.env.KEYCLOAK_SERVER_URL}/realms/${process.env.KEYCLOAK_REALM}`);
  }
  if (!process.env.AUTH0_DOMAIN && !process.env.KEYCLOAK_SERVER_URL) {
    console.log('  ⚠ No OAuth providers configured');
    console.log('  Set AUTH0_DOMAIN or KEYCLOAK_SERVER_URL in .env');
  }
  console.log('');
  console.log('MCP Client Usage:');
  console.log('  The client will automatically discover OAuth configuration');
  console.log('  via the .well-known endpoints and initiate the OAuth flow.');
  console.log('='.repeat(70));
});

