import { describe, expect, it } from "vitest";
import {
  getViewResourceUri,
  isViewTool,
} from "../../src/react/view/view-detection.js";

// MCP Apps (ext-apps) RESOURCE_URI_META_KEY: "Host developers must check both
// formats for compatibility" — nested `_meta.ui.resourceUri` and the
// deprecated flat `_meta["ui/resourceUri"]`.
describe("view detection with the legacy flat ui/resourceUri key", () => {
  it("detects a tool that only advertises _meta['ui/resourceUri']", () => {
    const meta = { "ui/resourceUri": "ui://weather/forecast.html" };
    expect(getViewResourceUri(meta)).toBe("ui://weather/forecast.html");
    expect(isViewTool(meta)).toBe(true);
  });

  it("prefers the nested key when both are present", () => {
    expect(
      getViewResourceUri({
        ui: { resourceUri: "ui://nested" },
        "ui/resourceUri": "ui://flat",
      })
    ).toBe("ui://nested");
  });
});
