import { describe, it, expect } from 'vitest';
import { createMCPServer } from '../../src/server/index.js';

describe('Context Passing', () => {
  it('should pass context to tool callbacks', async () => {
    const server = createMCPServer('test', { version: '1.0.0' });
    
    server.use((req, res, next) => {
      req.user = { userId: 'test-user' };
      next();
    });
    
    let contextReceived: any = null;
    
    server.tool({
      name: 'context-test',
      description: 'Test context',
      inputs: [],
      cb: async (params, context) => {
        contextReceived = context;
        return {
          content: [{
            type: 'text',
            text: 'ok'
          }]
        };
      }
    });
    
    const port = 3000 + Math.floor(Math.random() * 1000);
    await server.listen(port);
    
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'context-test',
          arguments: {}
        },
        id: 1
      })
    });
    
    expect(response.status).toBe(200);
    // Context should have been set by middleware
    expect(contextReceived).toBeDefined();
    expect(contextReceived?.req?.user?.userId).toBe('test-user');
  });
});

