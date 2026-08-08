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
