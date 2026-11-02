import type { ElicitRequestFormParams } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import {
  acceptWithDefaults,
  applyDefaults,
  getDefaults,
} from "../../../src/utils/elicitation.js";

describe("elicitation array defaults", () => {
  it("keeps the request schema and subsequent results independent", () => {
    const defaultTags = ["red"];
    const params: ElicitRequestFormParams = {
      mode: "form",
      message: "Choose tags",
      requestedSchema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string", enum: ["red", "blue"] },
            default: defaultTags,
          },
        },
      },
    };

    const first = getDefaults(params);
    if (!Array.isArray(first.tags)) throw new Error("Expected array default");
    first.tags.push("blue");

    expect(defaultTags).toEqual(["red"]);
    expect(getDefaults(params)).toEqual({ tags: ["red"] });
    expect(applyDefaults(params, {})).toEqual({ tags: ["red"] });
    expect(acceptWithDefaults(params)).toEqual({
      action: "accept",
      content: { tags: ["red"] },
    });
  });
});
