import { describe, it, expect, beforeEach } from 'vitest';
import { createMCPServer, bearerAuthMiddleware, oidcAuthMiddleware } from '../../src/server/index.js';
import { generateJWT } from '../helpers/auth-helpers.js';

describe('Authentication Middleware', () => {
  describe('bearerAuthMiddleware', () => {
    it('should validate bearer tokens', async () => {
      const server = createMCPServer('test-server', { version: '1.0.0' });
      
      server.use(bearerAuthMiddleware(async (token) => {
        if (token === 'valid-token') {
          return { userId: 'test-user', role: 'admin' };
        }
        throw new Error('Invalid token');
      }));
      
      server.tool({
        name: 'test',
        description: 'Test',
        inputs: [],
        cb: async (params, context) => {
          return {
            content: [{
              type: 'text',
              text: context?.req?.user?.userId || 'no user'
            }]
          };
        }
      });
      
      // Start server on random port
      const port = 3000 + Math.floor(Math.random() * 1000);
      await server.listen(port);
      
      // Test valid token
      const validResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1
        })
      });
      
      expect(validResponse.status).toBe(200);
      
      // Test invalid token
      const invalidResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token',
          'Content-Type': 'application/json'
        }
      });
      
      expect(invalidResponse.status).toBe(401);
    });
  });
  
  describe('oidcAuthMiddleware', () => {
    it('should require issuer and audience', () => {
      expect(() => {
        oidcAuthMiddleware({
          issuer: '',
          audience: ''
        });
      }).toThrow();
    });
    
    it('should normalize issuer URL', () => {
      const middleware = oidcAuthMiddleware({
        issuer: 'https://example.com/',
        audience: 'test-audience'
      });
      
      expect(middleware).toBeDefined();
    });
  });
});

