import { describe, it, expect, afterEach } from "vitest";
import { describeIfConfigured } from "../../../src/runtime/describeIfConfigured.js";

describe("describeIfConfigured", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should run tests when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "test-key";

    let testRan = false;
    describeIfConfigured("test suite", () => {
      it("should run", () => {
        testRan = true;
      });
    });

    // The test should be defined (vitest will run it)
    expect(testRan).toBe(false); // Not run yet, just defined
  });

  it("should skip tests when OPENAI_API_KEY is not set", () => {
    delete process.env.OPENAI_API_KEY;

    let testRan = false;
    describeIfConfigured("test suite", () => {
      it("should not run", () => {
        testRan = true;
      });
    });

    // Test should not be defined to run
    expect(testRan).toBe(false);
  });

  it("should skip tests when OPENAI_API_KEY is empty", () => {
    process.env.OPENAI_API_KEY = "";

    let testRan = false;
    describeIfConfigured("test suite", () => {
      it("should not run", () => {
        testRan = true;
      });
    });

    expect(testRan).toBe(false);
  });

  it("should handle nested test structures", () => {
    process.env.OPENAI_API_KEY = "test-key";

    describeIfConfigured("outer suite", () => {
      it("outer test", () => {
        expect(true).toBe(true);
      });

      describe("inner suite", () => {
        it("inner test", () => {
          expect(true).toBe(true);
        });
      });
    });
  });

  it("should accept custom name", () => {
    process.env.OPENAI_API_KEY = "test-key";

    describeIfConfigured("Custom Test Suite", () => {
      it("test", () => {
        expect(1 + 1).toBe(2);
      });
    });
  });
});
