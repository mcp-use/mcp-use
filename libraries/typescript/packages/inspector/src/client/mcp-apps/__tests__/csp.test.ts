import { describe, expect, it } from "vitest";
import {
  buildCSPString,
  diagnoseCsp,
  diffCspPolicies,
  getEffectiveCspPolicy,
  getObservedCspPolicy,
  getRequestedCspPolicy,
} from "../csp";

describe("CSP diagnostics", () => {
  it("allows eval while retaining widget-declared domain restrictions", () => {
    const policy = buildCSPString({
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    });

    expect(policy).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn.example.com"
    );
    expect(policy).toContain("connect-src https://api.example.com");
    expect(policy).toContain("frame-src 'none'");
  });

  it("diffs requested and effective policies", () => {
    const requested = getRequestedCspPolicy({
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    });
    const effective = getEffectiveCspPolicy(
      "default-src 'none'; connect-src https://other.example.com"
    );

    expect(diffCspPolicies(requested, effective)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          directive: "connect-src",
          status: "changed",
          requested: ["https://api.example.com"],
          effective: ["https://other.example.com"],
        }),
        expect.objectContaining({
          directive: "img-src",
          status: "missing",
        }),
      ])
    );
  });

  it("groups observed violations into concise findings", () => {
    const violations = [
      {
        directive: "connect-src",
        effectiveDirective: "connect-src",
        blockedUri: "https://api.example.com/data",
        timestamp: 1,
      },
      {
        directive: "connect-src",
        effectiveDirective: "connect-src",
        blockedUri: "https://api.example.com/data",
        timestamp: 2,
      },
    ];

    expect(getObservedCspPolicy(violations)).toEqual({
      "connect-src": ["https://api.example.com/data"],
    });
    expect(
      diagnoseCsp({
        mode: "widget-declared",
        declared: { connectDomains: [] },
        violations,
      })
    ).toContainEqual(
      expect.objectContaining({
        severity: "error",
        title: "1 blocked by connect-src",
      })
    );
  });
});
