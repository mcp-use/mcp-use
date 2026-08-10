import { describe, expect, it } from "vitest";
import { buildCspAuditRecord } from "../csp-audit";

describe("buildCspAuditRecord", () => {
  it("records the effective mode and declared domain origins", () => {
    expect(
      buildCspAuditRecord({
        viewId: "widget-1",
        mode: "widget-declared",
        declared: {
          connectDomains: ["https://api.example.com/path?token=secret"],
          resourceDomains: ["https://cdn.example.com/assets#section"],
          frameDomains: ["https://frames.example.com"],
          baseUriDomains: ["https://app.example.com/base"],
        },
      })
    ).toEqual({
      event: "mcp-apps-csp-applied",
      viewId: "widget-1",
      mode: "widget-declared",
      source: "widget-metadata",
      domains: {
        connect: ["https://api.example.com"],
        resource: ["https://cdn.example.com"],
        frame: ["https://frames.example.com"],
        baseUri: ["https://app.example.com"],
      },
    });
  });

  it("marks permissive mode as an explicit debug override", () => {
    expect(
      buildCspAuditRecord({
        viewId: "widget-2",
        mode: "permissive",
        declared: undefined,
      })
    ).toMatchObject({
      mode: "permissive",
      source: "debug-override",
    });
  });
});
