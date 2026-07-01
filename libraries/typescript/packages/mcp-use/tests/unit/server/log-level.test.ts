/**
 * Tests for the consolidated `MCP_USE_LOG_LEVEL` resolver that replaced the
 * pre-P4 `MCP_DEBUG_LEVEL` / `DEBUG` / `VERBOSE` trio.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  isDebugEnabled,
  LOG_LEVEL_ENV,
  resolveLogLevel,
} from "../../../src/log-level.js";

describe("resolveLogLevel", () => {
  afterEach(() => {
    delete process.env[LOG_LEVEL_ENV];
  });

  it("defaults to info when unset", () => {
    delete process.env[LOG_LEVEL_ENV];
    expect(resolveLogLevel()).toBe("info");
  });

  it("parses the three known levels", () => {
    for (const level of ["info", "debug", "trace"] as const) {
      process.env[LOG_LEVEL_ENV] = level;
      expect(resolveLogLevel()).toBe(level);
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    process.env[LOG_LEVEL_ENV] = "  DEBUG ";
    expect(resolveLogLevel()).toBe("debug");
  });

  it("falls back to info for unknown values", () => {
    process.env[LOG_LEVEL_ENV] = "verbose";
    expect(resolveLogLevel()).toBe("info");
  });

  it("honors an explicit override over the environment", () => {
    process.env[LOG_LEVEL_ENV] = "trace";
    expect(resolveLogLevel("info")).toBe("info");
  });

  it("does not read the removed legacy DEBUG/VERBOSE vars", () => {
    delete process.env[LOG_LEVEL_ENV];
    process.env.DEBUG = "1";
    process.env.VERBOSE = "1";
    process.env.MCP_DEBUG_LEVEL = "trace";
    try {
      expect(resolveLogLevel()).toBe("info");
    } finally {
      delete process.env.DEBUG;
      delete process.env.VERBOSE;
      delete process.env.MCP_DEBUG_LEVEL;
    }
  });
});

describe("isDebugEnabled", () => {
  afterEach(() => {
    delete process.env[LOG_LEVEL_ENV];
  });

  it("is false at info", () => {
    process.env[LOG_LEVEL_ENV] = "info";
    expect(isDebugEnabled()).toBe(false);
  });

  it("is true at debug and trace", () => {
    process.env[LOG_LEVEL_ENV] = "debug";
    expect(isDebugEnabled()).toBe(true);
    process.env[LOG_LEVEL_ENV] = "trace";
    expect(isDebugEnabled()).toBe(true);
  });
});
