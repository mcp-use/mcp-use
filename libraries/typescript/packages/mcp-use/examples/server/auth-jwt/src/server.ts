import { createMCPServer, oidcAuthMiddleware } from 'mcp-use/server';

/**
 * JWT Authentication Example with OIDC
 * 
 * This example shows how to integrate MCP servers with ANY OIDC-compliant
 * provider using standard OpenID Connect Discovery:
 * - Auth0
 * - Keycloak
 * - Okta
 * - Azure AD
 * - Google
 * - Any other OIDC provider
 * 
 * The middleware automatically discovers JWKS endpoints and validates tokens.
 */

const server = createMCPServer('jwt-auth-server', {
  version: '1.0.0',
  description: 'MCP server with JWT authentication (OIDC)'
});

// Add JWT authentication middleware
// Uses standard OIDC discovery - works with any OIDC provider
if (process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE) {
  server.use(oidcAuthMiddleware({
    issuer: process.env.OIDC_ISSUER,
    audience: process.env.OIDC_AUDIENCE,
  }));
}

// Tool that shows user information from JWT claims
server.tool({
  name: 'whoami',
  description: 'Get information about the authenticated user from JWT token',
  inputs: [],
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          userId: user.sub,
          email: user.email,
          name: user.name,
          roles: user.roles || [],
          permissions: user.permissions || [],
          provider: user.iss?.includes('auth0') ? 'Auth0' : 
                   user.iss?.includes('keycloak') ? 'Keycloak' : 'Unknown'
        }, null, 2)
      }]
    };
  }
});

// Tool with permission-based authorization
server.tool({
  name: 'admin-action',
  description: 'Perform an admin action (requires admin role)',
  inputs: [
    { name: 'action', type: 'string', required: true }
  ],
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    // Check if user has admin role
    const isAdmin = user?.roles?.includes('admin') || 
                   user?.['realm_access']?.roles?.includes('admin');
    
    if (!isAdmin) {
      throw new Error('Insufficient permissions. Admin role required.');
    }
    
    console.log(`[ADMIN] User ${user.email} performed: ${params.action}`);
    
    return {
      content: [{
        type: 'text',
        text: `Admin action "${params.action}" executed successfully by ${user.email}`
      }]
    };
  }
});

// Multi-tenant tool using organization/tenant from JWT
server.tool({
  name: 'get-tenant-data',
  description: 'Get data for the authenticated user\'s tenant',
  inputs: [
    { name: 'resource', type: 'string', required: true }
  ],
  cb: async (params, context) => {
    const user = context?.req?.user;
    
    // Extract tenant/organization from JWT claims
    const tenantId = user?.org_id || user?.organization || user?.tenant || 'default';
    
    console.log(`[TENANT] Fetching ${params.resource} for tenant: ${tenantId}`);
    
    return {
      content: [{
        type: 'text',
        text: `Resource "${params.resource}" for tenant ${tenantId}: [data here]`
      }]
    };
  }
});

const PORT = process.env.PORT || 3001;

server.listen(PORT).then(() => {
  const issuer = process.env.OIDC_ISSUER || '(not configured)';
  const audience = process.env.OIDC_AUDIENCE || '(not configured)';
  
  console.log('='.repeat(70));
  console.log('JWT Authentication Example (OIDC)');
  console.log('='.repeat(70));
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Inspector (no auth): http://localhost:${PORT}/inspector`);
  console.log('');
  console.log('OIDC Configuration:');
  console.log(`  Issuer: ${issuer}`);
  console.log(`  Audience: ${audience}`);
  
  if (!process.env.OIDC_ISSUER || !process.env.OIDC_AUDIENCE) {
    console.log('');
    console.log('  ⚠ OIDC not configured. Set OIDC_ISSUER and OIDC_AUDIENCE');
    console.log('');
    console.log('  Example for Auth0:');
    console.log('    OIDC_ISSUER=https://your-tenant.auth0.com');
    console.log('    OIDC_AUDIENCE=your-api-identifier');
    console.log('');
    console.log('  Example for Keycloak:');
    console.log('    OIDC_ISSUER=https://keycloak.example.com/realms/myrealm');
    console.log('    OIDC_AUDIENCE=mcp-server');
  }
  console.log('');
  console.log('Test with JWT token:');
  console.log(`  curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \\`);
  console.log(`    http://localhost:${PORT}/mcp`);
  console.log('='.repeat(70));
});

