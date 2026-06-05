import { describe, expect, it } from "vitest";
import {
  buildOpenInAppUrlInjectionScript,
  getWidgetOpenaiConfig,
  injectWidgetOpenaiConfig,
} from "../../../src/server/widgets/widget-openai-config.js";

describe("widget openai config", () => {
  it("reads openInAppUrl from widget metadata", () => {
    expect(
      getWidgetOpenaiConfig({
        openai: { openInAppUrl: "https://example.com/app" },
      })
    ).toEqual({ openInAppUrl: "https://example.com/app" });
  });

  it("returns undefined when openInAppUrl is missing or blank", () => {
    expect(getWidgetOpenaiConfig({ openai: {} })).toBeUndefined();
    expect(
      getWidgetOpenaiConfig({ openai: { openInAppUrl: "   " } })
    ).toBeUndefined();
    expect(getWidgetOpenaiConfig({})).toBeUndefined();
  });

  it("injects openInAppUrl script into widget HTML", () => {
    const html = "<html><head></head><body></body></html>";
    const result = injectWidgetOpenaiConfig(
      html,
      "https://example.com/products/123"
    );

    expect(result).toContain("window.__mcpWidgetOpenai");
    expect(result).toContain("setOpenInAppUrl");
    expect(result).toContain("https://example.com/products/123");
  });

  it("does not inject duplicate openInAppUrl scripts", () => {
    const html = injectWidgetOpenaiConfig(
      "<html><head></head><body></body></html>",
      "https://example.com/app"
    );

    expect(
      injectWidgetOpenaiConfig(html, "https://example.com/app")
    ).toBe(html);
  });

  it("builds a script that sets window.__mcpWidgetOpenai", () => {
    const script = buildOpenInAppUrlInjectionScript("https://chatgpt.com/app");
    expect(script).toContain('openInAppUrl":"https://chatgpt.com/app"');
    expect(script.startsWith("<script>")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
  });
});
