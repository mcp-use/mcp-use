import { describe, expect, it } from "vitest";
import {
  MAX_WIDGET_IMAGE_SIZE,
  MAX_WIDGET_MESSAGE_SIZE,
  normalizeWidgetMessage,
  validateWidgetImageSizes,
} from "../widget-message";

describe("normalizeWidgetMessage", () => {
  it("normalizes text and image blocks without dropping either modality", () => {
    expect(
      normalizeWidgetMessage([
        { type: "text", text: "Compare these" },
        {
          type: "image",
          mimeType: "image/png",
          data: "aGVsbG8=",
        },
      ])
    ).toEqual({
      text: "Compare these",
      attachments: [
        {
          type: "image",
          mimeType: "image/png",
          data: "aGVsbG8=",
          name: "widget-image-1",
          size: 5,
        },
      ],
    });
  });

  it("keeps assistant-only text for the model and hides it from the conversation", () => {
    expect(
      normalizeWidgetMessage([
        {
          type: "text",
          text: "Internal app instruction: refresh the summary.",
          annotations: { audience: ["assistant"] },
        },
      ])
    ).toEqual({
      text: "Internal app instruction: refresh the summary.",
      attachments: [],
      displayText: "",
    });
  });

  it("shows only the user-visible blocks of a mixed message", () => {
    expect(
      normalizeWidgetMessage([
        { type: "text", text: "Show me the summary." },
        {
          type: "text",
          text: "Context: page 3, sort=price.",
          annotations: { audience: ["assistant"] },
        },
        {
          type: "image",
          mimeType: "image/png",
          data: "aGVsbG8=",
          annotations: { audience: ["assistant"] },
        },
      ])
    ).toEqual({
      text: "Show me the summary.\nContext: page 3, sort=price.",
      attachments: [
        {
          type: "image",
          mimeType: "image/png",
          data: "aGVsbG8=",
          name: "widget-image-1",
          size: 5,
          modelOnly: true,
        },
      ],
      displayText: "Show me the summary.",
    });
  });

  it.each([
    ["no annotations", undefined],
    ["a user audience", { audience: ["user"] }],
    ["a shared audience", { audience: ["user", "assistant"] }],
    ["a malformed audience", { audience: "assistant" }],
    ["an unknown audience role", { audience: ["system"] }],
    ["an unknown role next to assistant", { audience: ["assistant", 42] }],
  ])("shows text with %s", (_label, annotations) => {
    expect(
      normalizeWidgetMessage([{ type: "text", text: "Hi", annotations }])
    ).toEqual({ text: "Hi", attachments: [] });
  });

  it("rejects the complete message when any block is unsupported", () => {
    expect(() =>
      normalizeWidgetMessage([
        { type: "text", text: "Do not partially send this" },
        { type: "audio", data: "AAAA", mimeType: "audio/wav" },
      ])
    ).toThrow("Unsupported ui/message content block: audio");
  });

  it("rejects invalid image types and base64", () => {
    expect(() =>
      normalizeWidgetMessage([
        { type: "image", data: "AAAA", mimeType: "application/pdf" },
      ])
    ).toThrow("Unsupported ui/message image type");
    expect(() =>
      normalizeWidgetMessage([
        { type: "image", data: "not base64!", mimeType: "image/png" },
      ])
    ).toThrow("must be valid base64");
  });
});

describe("validateWidgetImageSizes", () => {
  it("enforces both per-file and total Chat attachment limits", () => {
    expect(() =>
      validateWidgetImageSizes([MAX_WIDGET_IMAGE_SIZE])
    ).not.toThrow();
    expect(() => validateWidgetImageSizes([MAX_WIDGET_IMAGE_SIZE + 1])).toThrow(
      "10 MB per-file"
    );
    expect(() =>
      validateWidgetImageSizes([
        MAX_WIDGET_MESSAGE_SIZE / 2,
        MAX_WIDGET_MESSAGE_SIZE / 2,
        1,
      ])
    ).toThrow("20 MB total");
  });
});
