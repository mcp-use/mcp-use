import { describe, expect, it } from "vitest";
import { mergeToolMetadata } from "../tool-metadata";

describe("mergeToolMetadata", () => {
  it("retains MCP Apps metadata when a result adds unrelated metadata", () => {
    expect(
      mergeToolMetadata(
        {
          ui: {
            resourceUri: "ui://conformance/runner",
            visibility: ["model", "app"],
          },
          "ui/resourceUri": "ui://conformance/runner",
        },
        {
          "alpic/analytics": {
            distinctId: "test-session",
          },
        }
      )
    ).toEqual({
      ui: {
        resourceUri: "ui://conformance/runner",
        visibility: ["model", "app"],
      },
      "ui/resourceUri": "ui://conformance/runner",
      "alpic/analytics": {
        distinctId: "test-session",
      },
    });
  });

  it("lets result metadata override matching fields without dropping nested UI fields", () => {
    expect(
      mergeToolMetadata(
        {
          ui: {
            resourceUri: "ui://old",
            visibility: ["model"],
          },
        },
        {
          ui: {
            resourceUri: "ui://new",
          },
        }
      )
    ).toEqual({
      ui: {
        resourceUri: "ui://new",
        visibility: ["model"],
      },
    });
  });
});
