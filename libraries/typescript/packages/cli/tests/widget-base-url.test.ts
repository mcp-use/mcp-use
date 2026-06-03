import { describe, expect, it } from "vitest";

import { getWidgetBuildBaseUrl } from "../src/utils/widget-base-url.js";

describe("widget build base URL", () => {
  it("uses the production widget route under MCP_URL", () => {
    expect(
      getWidgetBuildBaseUrl("chart-widget", "https://my-slug.run.mcp-use.com")
    ).toBe("https://my-slug.run.mcp-use.com/mcp-use/widgets/chart-widget/");
  });

  it("trims a trailing slash from MCP_URL before appending the widget route", () => {
    expect(
      getWidgetBuildBaseUrl("chart-widget", "https://my-slug.run.mcp-use.com/")
    ).toBe("https://my-slug.run.mcp-use.com/mcp-use/widgets/chart-widget/");
  });

  it("keeps the existing relative production route when MCP_URL is unset", () => {
    expect(getWidgetBuildBaseUrl("chart-widget")).toBe(
      "/mcp-use/widgets/chart-widget/"
    );
  });
});
