import { describe, expect, it } from "vitest";
import {
  getVisibleMessageContent,
  isHiddenFromUser,
} from "../message-visibility";
import type { Message } from "../types";

const base: Message = { id: "u1", role: "user", content: "", timestamp: 0 };
const image = { type: "image" as const, data: "aGk=", mimeType: "image/png" };

describe("message visibility", () => {
  it("hides a message whose text and images are all model-only", () => {
    const message: Message = {
      ...base,
      content: "Internal instruction",
      displayContent: "",
      attachments: [{ ...image, modelOnly: true }],
    };
    expect(getVisibleMessageContent(message)).toEqual({
      text: "",
      attachments: [],
    });
    expect(isHiddenFromUser(message)).toBe(true);
  });

  it("keeps a message visible when a visible image remains", () => {
    const message: Message = {
      ...base,
      content: "Internal instruction",
      displayContent: "",
      attachments: [image],
    };
    expect(isHiddenFromUser(message)).toBe(false);
  });

  it("falls back to the full content when no display text is stored", () => {
    expect(
      getVisibleMessageContent({ ...base, content: "Typed by the user" }).text
    ).toBe("Typed by the user");
  });
});
