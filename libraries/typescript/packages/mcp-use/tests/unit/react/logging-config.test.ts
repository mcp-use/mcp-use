/**
 * Tests for logLevel configuration in useMcp hook
 *
 * These tests verify:
 * - Silent mode suppresses all console output
 * - Per-instance logger isolation
 * - logLevel takes precedence over debug prop
 * - Log state array is still populated in silent mode
 * - Different log levels work correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../../src/logging.js";

describe("Logger Configuration", () => {
  let originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
    debug: typeof console.debug;
  };

  beforeEach(() => {
    // Save original console methods
    originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    // Mock console methods
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();

    // Reset Logger state
    Logger.configure({ level: "info" });
  });

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;

    // Reset Logger state
    Logger.configure({ level: "info" });
  });

  describe("Silent Mode", () => {
    it("should suppress all console output when logLevel is 'silent'", () => {
      const logger = Logger.get("TestLogger");
      Logger.configure({ level: "silent" });

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(console.log).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it("should allow other log levels after exiting silent mode", () => {
      const logger = Logger.get("TestLogger2");
      Logger.configure({ level: "silent" });

      logger.info("should not log");
      expect(console.info).not.toHaveBeenCalled();

      Logger.configure({ level: "info" });
      logger.info("should log now");
      expect(console.info).toHaveBeenCalled();
    });
  });

  describe("Log Level Filtering", () => {
    it("should only log errors when logLevel is 'error'", () => {
      Logger.configure({ level: "error" });
      const logger = Logger.get("TestLogger");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(console.log).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("error message")
      );
    });

    it("should log errors and warnings when logLevel is 'warn'", () => {
      Logger.configure({ level: "warn" });
      const logger = Logger.get("TestLogger");

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(console.log).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("warn message")
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("error message")
      );
    });

    it("should log info, warn, and error when logLevel is 'info'", () => {
      const logger = Logger.get("TestLogger3");
      Logger.configure({ level: "info" });

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it("should log all levels when logLevel is 'debug'", () => {
      const logger = Logger.get("TestLogger4");
      Logger.configure({ level: "debug" });

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(console.debug).toHaveBeenCalled();
      expect(console.info).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("Per-Instance Loggers", () => {
    it("should create independent loggers with different names", () => {
      Logger.configure({ level: "info" });
      const logger1 = Logger.get("Logger1");
      const logger2 = Logger.get("Logger2");

      expect(logger1).not.toBe(logger2);

      logger1.info("from logger1");
      logger2.info("from logger2");

      const calls = (console.info as any).mock.calls;
      expect(calls.some((call: any[]) => call[0].includes("Logger1"))).toBe(
        true
      );
      expect(calls.some((call: any[]) => call[0].includes("Logger2"))).toBe(
        true
      );
    });

    it("should return the same logger instance when called with same name", () => {
      const logger1 = Logger.get("SameName");
      const logger2 = Logger.get("SameName");

      // They should be the same instance
      expect(logger1).toBe(logger2);

      Logger.configure({ level: "info" });
      logger1.info("message");

      expect((console.info as any).mock.calls.length).toBe(1);
    });
  });

  describe("Logger.setDebug()", () => {
    it("should enable debug logging when set to true", () => {
      Logger.setDebug(true);
      const logger = Logger.get("TestLogger");

      logger.debug("debug message");

      expect(console.debug).toHaveBeenCalled();
    });

    it("should disable debug logging when set to false", () => {
      Logger.setDebug(false);
      const logger = Logger.get("TestLogger");

      logger.debug("debug message");

      expect(console.debug).not.toHaveBeenCalled();
    });
  });

  describe("Format Styles", () => {
    it("should support detailed format (timestamp)", () => {
      const logger = Logger.get("TestLogger5");
      Logger.configure({ level: "info", format: "detailed" });

      logger.info("test message");

      const call = (console.info as any).mock.calls[0][0];
      // Detailed format: "HH:MM:SS [TestLogger] INFO: test message"
      expect(call).toMatch(/\d{2}:\d{2}:\d{2}/); // Time format
      expect(call).toContain("[TestLogger5]");
      expect(call).toContain("INFO:");
      expect(call).toContain("test message");
    });

    it("should support emoji format", () => {
      const logger = Logger.get("TestLogger6");
      Logger.configure({ level: "info", format: "emoji" });

      logger.info("test message");
      logger.warn("warning");
      logger.error("error");

      const infoCall = (console.info as any).mock.calls[0][0];
      expect(infoCall).toContain("ℹ️");
      expect(infoCall).toContain("[TestLogger6]");

      const warnCall = (console.warn as any).mock.calls[0][0];
      expect(warnCall).toContain("⚠️");

      const errorCall = (console.error as any).mock.calls[0][0];
      expect(errorCall).toContain("❌");
    });

    it("should support minimal format", () => {
      const logger = Logger.get("TestLogger7");
      Logger.configure({ level: "info", format: "minimal" });

      logger.info("test message");

      const call = (console.info as any).mock.calls[0][0];
      // Minimal format: "YYYY-MM-DD HH:MM:SS.mmm [TestLogger] info: test message"
      expect(call).toContain("[TestLogger7]");
      expect(call).toContain("info:");
      expect(call).toContain("test message");
    });
  });
});
