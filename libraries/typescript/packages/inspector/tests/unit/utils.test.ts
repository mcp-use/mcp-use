import { describe, expect, it } from "vitest";
import { formatErrorDiagnostic } from "../../src/server/utils.js";

describe("formatErrorDiagnostic", () => {
  it("keeps the safe error type and system code without logging the message", () => {
    const error = Object.assign(
      new TypeError(
        "secret origin https://private.example.com?token=do-not-log"
      ),
      { code: "EADDRINUSE" }
    );

    expect(formatErrorDiagnostic(error)).toBe("TypeError (EADDRINUSE)");
  });

  it("rejects user-controlled names and codes", () => {
    const error = Object.assign(new Error("secret"), {
      name: "Error: Bearer secret",
      code: "bad code with secret",
    });

    expect(formatErrorDiagnostic(error)).toBe("Error");
    expect(formatErrorDiagnostic("Bearer secret")).toBe(
      "UnknownError (string)"
    );
  });
});
