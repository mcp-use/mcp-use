/**
 * Test file for Express middleware type compatibility
 * 
 * Verifies that Express middleware can be passed to server.use() without type errors
 */

import { describe, it, expect } from "vitest";
import { MCPServer } from "../../../src/server/index.js";

describe("Express Middleware Type Compatibility", () => {
  it("should accept Express middleware without type errors", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    // Express middleware signature: (req, res, next) => void
    const expressMiddleware = (req: any, res: any, next: () => void) => {
      next();
    };

    // Should not have type errors
    server.use(expressMiddleware);
    server.use("/api", expressMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });

  it("should accept Express error middleware without type errors", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    // Express error middleware signature: (err, req, res, next) => void
    const expressErrorMiddleware = (
      err: any,
      req: any,
      res: any,
      next: () => void
    ) => {
      next();
    };

    // Should not have type errors
    server.use(expressErrorMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });

  it("should accept Hono middleware without type errors", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    // Hono middleware signature: (c, next) => Promise<Response | void>
    const honoMiddleware = async (c: any, next: any) => {
      await next();
    };

    // Should not have type errors
    server.use(honoMiddleware);
    server.use("/api", honoMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });

  it("should accept mixed Express and Hono middleware without type errors", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    const expressMiddleware = (req: any, res: any, next: () => void) => {
      next();
    };

    const honoMiddleware = async (c: any, next: any) => {
      await next();
    };

    // Should not have type errors when mixing middleware types
    server.use(expressMiddleware, honoMiddleware);
    server.use("/api", expressMiddleware, honoMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });

  it("should accept Express middleware with async/await", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    // Express middleware can return Promise<void>
    const asyncExpressMiddleware = async (
      req: any,
      res: any,
      next: () => void
    ) => {
      await Promise.resolve();
      next();
    };

    // Should not have type errors
    server.use(asyncExpressMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });
});
