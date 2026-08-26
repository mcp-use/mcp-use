import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolLimitWarningBanner } from "../ToolLimitWarningBanner";

describe("ToolLimitWarningBanner", () => {
  it("describes the filtered count as model-visible tools", () => {
    const markup = renderToStaticMarkup(
      <ToolLimitWarningBanner provider="openai" toolCount={129} />
    );

    expect(markup).toContain("129");
    expect(markup).toContain("model-visible tools");
    expect(markup).not.toContain("This server has");
  });
});
