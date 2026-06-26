import { describe, expect, it } from "vitest";
import { AppsSdkAdapter } from "../../../src/server/widgets/adapters/apps-sdk.js";
import type { UIResourceDefinition } from "../../../src/server/types/resource.js";

describe("AppsSdkAdapter.buildResourceMetadata — widgetDescription default", () => {
  const adapter = new AppsSdkAdapter();

  function definition(
    overrides: Partial<Record<string, unknown>> = {}
  ): UIResourceDefinition {
    return {
      type: "appsSdk",
      name: "demo-widget",
      htmlString: "<html></html>",
      description: "Shows a demo of search results",
      ...overrides,
    } as unknown as UIResourceDefinition;
  }

  it("defaults openai/widgetDescription from the widget description", () => {
    const { _meta } = adapter.buildResourceMetadata(definition());
    expect(_meta?.["openai/widgetDescription"]).toBe(
      "Shows a demo of search results"
    );
  });

  it("falls back to metadata.description when no top-level description", () => {
    const def = definition({
      description: undefined,
      metadata: { description: "From unified metadata" },
    });
    const { _meta } = adapter.buildResourceMetadata(def);
    expect(_meta?.["openai/widgetDescription"]).toBe("From unified metadata");
  });

  it("does not override an explicit widgetDescription", () => {
    const def = definition({
      metadata: { widgetDescription: "Explicit summary" },
    });
    const { _meta } = adapter.buildResourceMetadata(def);
    expect(_meta?.["openai/widgetDescription"]).toBe("Explicit summary");
  });

  it("omits widgetDescription when there is no description anywhere", () => {
    const def = definition({ description: undefined });
    const { _meta } = adapter.buildResourceMetadata(def);
    expect(_meta?.["openai/widgetDescription"]).toBeUndefined();
  });
});
