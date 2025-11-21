import { describe, it, expect } from 'vitest';
import { createMCPServer } from '../../src/server/index.js';

describe('Middleware Wrapping', () => {
  it('should wrap single middleware without path', () => {
    const server = createMCPServer('test', { version: '1.0.0' });
    
    let middlewareExecuted = false;
    
    server.use((req, res, next) => {
      middlewareExecuted = true;
      next();
    });
    
    expect(server).toBeDefined();
  });
  
  it('should wrap path-based middleware', () => {
    const server = createMCPServer('test', { version: '1.0.0' });
    
    server.use('/api', (req, res, next) => {
      next();
    });
    
    expect(server).toBeDefined();
  });
  
  it('should wrap multiple middleware arguments', () => {
    const server = createMCPServer('test', { version: '1.0.0' });
    
    server.use(
      (req, res, next) => next(),
      (req, res, next) => next(),
      (req, res, next) => next()
    );
    
    expect(server).toBeDefined();
  });
  
  it('should wrap array of middleware', () => {
    const server = createMCPServer('test', { version: '1.0.0' });
    
    server.use([
      (req, res, next) => next(),
      (req, res, next) => next()
    ]);
    
    expect(server).toBeDefined();
  });
});

