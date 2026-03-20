/**
 * Test file for Express middleware compatibility
 *
 * Verifies that Express middleware from npm packages can be used with server.use()
 */

import { describe, it, expect } from "vitest";
import { MCPServer } from "../../../src/server/index.js";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

describe("Express Middleware Compatibility", () => {
  it("should accept Express middleware from npm packages", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    const morganLogger = morgan("combined");
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
    });

    // Should not have type errors
    server.use(morganLogger);
    server.use("/api", apiLimiter);

    expect(true).toBe(true); // If we get here, types are correct
  });

  it("should accept Hono middleware", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    const honoMiddleware = async (c, next) => {
      await next();
    };

    // Should not have type errors
    server.use(honoMiddleware);
    server.use("/api", honoMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });

  it("should accept mixed Express and Hono middleware", () => {
    const server = new MCPServer({
      name: "test-server",
      version: "1.0.0",
    });

    const morganLogger = morgan("dev");
    const honoMiddleware = async (c, next) => {
      await next();
    };

    // Should not have type errors when mixing middleware types
    server.use(morganLogger, honoMiddleware);
    server.use("/api", morganLogger, honoMiddleware);

    expect(true).toBe(true); // If we get here, types are correct
  });
});
