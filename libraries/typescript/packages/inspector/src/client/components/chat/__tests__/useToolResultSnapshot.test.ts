import { describe, expect, it } from "vitest";
import { updateToolResultSnapshot } from "../useToolResultSnapshot";

describe("updateToolResultSnapshot", () => {
  it("observes a streamed result that is completed by in-place mutation", () => {
    const result: {
      content?: Array<{ type: string; text: string }>;
      structuredContent?: { message: string };
    } = {};
    const pendingSnapshot = updateToolResultSnapshot(null, result);

    result.content = [{ type: "text", text: "Ready" }];
    result.structuredContent = { message: "Ready" };
    const completedSnapshot = updateToolResultSnapshot(pendingSnapshot, result);

    expect(completedSnapshot).not.toBe(pendingSnapshot);
    expect(completedSnapshot.value).toEqual({
      content: [{ type: "text", text: "Ready" }],
      structuredContent: { message: "Ready" },
    });
    expect(pendingSnapshot.value).toEqual({});
  });

  it("keeps the snapshot stable when the result content has not changed", () => {
    const result = { structuredContent: { message: "Ready" } };
    const firstSnapshot = updateToolResultSnapshot(null, result);
    const secondSnapshot = updateToolResultSnapshot(firstSnapshot, result);

    expect(secondSnapshot).toBe(firstSnapshot);
  });
});
