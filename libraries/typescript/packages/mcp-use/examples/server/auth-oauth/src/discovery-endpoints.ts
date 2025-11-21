import { type McpServerInstance } from 'mcp-use/server';

/**
 * Setup OAuth 2.0 Discovery Endpoints
 * 
 * Implements:
 * - OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * - OpenID Connect Discovery 1.0
 * - OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * 
 * This allows MCP clients to automatically discover OAuth configuration
 * and initiate authentication flows without manual configuration.
 */

export function setupDiscoveryEndpoints(server: McpServerInstance) {
  const issuer = process.env.OIDC_ISSUER;
  
  if (!issuer) {
    console.warn('[DISCOVERY] OIDC_ISSUER not configured. Discovery endpoints will return errors.');
  }

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  // https://datatracker.ietf.org/doc/html/rfc8414
  server.get('/.well-known/oauth-authorization-server', async (req, res) => {
    if (!issuer) {
      return res.status(503).json({
        error: 'not_configured',
        error_description: 'OAuth provider not configured. Set OIDC_ISSUER environment variable.'
      });
    }

    try {
      // Fetch metadata from the configured OIDC provider
      const response = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
      
      if (response.ok) {
        const metadata = await response.json();
        return res.json(metadata);
      }
      
      // Fallback to OpenID configuration
      const oidcResponse = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (oidcResponse.ok) {
        const metadata = await oidcResponse.json();
        return res.json(metadata);
      }
      
      return res.status(404).json({
        error: 'not_found',
        error_description: 'OAuth authorization server metadata not found'
      });
    } catch (error) {
      console.error('[DISCOVERY] Failed to fetch OAuth metadata:', error);
      return res.status(502).json({
        error: 'upstream_error',
        error_description: 'Failed to fetch metadata from OAuth provider'
      });
    }
  });

  // OpenID Connect Discovery (OpenID Connect Discovery 1.0)
  // https://openid.net/specs/openid-connect-discovery-1_0.html
  server.get('/.well-known/openid-configuration', async (req, res) => {
    if (!issuer) {
      return res.status(503).json({
        error: 'not_configured',
        error_description: 'OAuth provider not configured. Set OIDC_ISSUER environment variable.'
      });
    }

    try {
      // Proxy the OIDC configuration from the provider
      const response = await fetch(`${issuer}/.well-known/openid-configuration`);
      
      if (!response.ok) {
        return res.status(response.status).json({
          error: 'upstream_error',
          error_description: `Provider returned ${response.status} ${response.statusText}`
        });
      }
      
      const config = await response.json();
      return res.json(config);
    } catch (error) {
      console.error('[DISCOVERY] Failed to fetch OIDC configuration:', error);
      return res.status(502).json({
        error: 'upstream_error',
        error_description: 'Failed to fetch configuration from OAuth provider'
      });
    }
  });

  // OAuth 2.0 Protected Resource Metadata (RFC 9728)
  // Returns metadata about this protected resource (MCP server)
  server.get('/.well-known/oauth-protected-resource', (req, res) => {
    if (!issuer) {
      return res.status(503).json({
        error: 'not_configured',
        error_description: 'OAuth provider not configured. Set OIDC_ISSUER environment variable.'
      });
    }

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
    const audience = process.env.OIDC_AUDIENCE;

    res.json({
      // Resource server information
      resource: baseUrl,
      authorization_servers: [issuer],
      
      // Scopes supported by this resource
      scopes_supported: [
        'mcp:read',
        'mcp:write',
        'admin'
      ],
      
      // Bearer token usage
      bearer_methods_supported: ['header'],
      resource_signing_alg_values_supported: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      
      // Audience claim
      ...(audience && { resource_audience: audience }),
      
      // Documentation
      resource_documentation: `${baseUrl}/docs`,
      
      // MCP-specific extensions
      'mcp:capabilities': {
        tools: true,
        resources: true,
        prompts: true,
        logging: false
      }
    });
  });

  console.log('[DISCOVERY] OAuth discovery endpoints configured');
  console.log(`  /.well-known/oauth-authorization-server`);
  console.log(`  /.well-known/openid-configuration`);
  console.log(`  /.well-known/oauth-protected-resource`);
}

