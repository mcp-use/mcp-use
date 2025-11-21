import jwt from 'jsonwebtoken';
import { createMCPServer, type McpServerInstance } from '../../src/server/index.js';

/**
 * Generate a test JWT token
 */
export function generateJWT(
  claims: Record<string, any>,
  secret: string,
  options?: jwt.SignOptions
): string {
  return jwt.sign(claims, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
    ...options
  });
}

/**
 * Generate RSA key pair for testing
 */
export async function generateRSAKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const { generateKeyPairSync } = await import('crypto');
  
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  return { publicKey, privateKey };
}

/**
 * Create a test server with optional auth
 */
export function createTestServer(config?: {
  name?: string;
  version?: string;
  enableAuth?: boolean;
  authType?: 'bearer' | 'oidc';
}): McpServerInstance {
  const server = createMCPServer(config?.name || 'test-server', {
    version: config?.version || '1.0.0'
  });
  
  // Add test tool
  server.tool({
    name: 'test-tool',
    description: 'Test tool',
    inputs: [],
    cb: async (params, context) => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            user: context?.req?.user,
            scopes: context?.req?.scopes
          })
        }]
      };
    }
  });
  
  return server;
}

/**
 * Make authenticated HTTP request to MCP server
 */
export async function makeAuthenticatedRequest(
  url: string,
  token: string,
  body?: any
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

/**
 * Wait for server to be ready
 */
export async function waitForServer(url: string, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 401) {
        return;
      }
    } catch (error) {
      // Server not ready, wait and retry
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

