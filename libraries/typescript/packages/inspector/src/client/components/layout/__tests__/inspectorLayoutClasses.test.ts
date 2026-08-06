import { describe, expect, it } from "vitest";
import {
  getInspectorBodyClassName,
  getInspectorHeaderClassName,
} from "../inspectorLayoutClasses";

describe("embedded Inspector layout classes", () => {
  it("lets a single-tab main panel fill the iframe height", () => {
    expect(getInspectorBodyClassName(true).split(" ")).toContain("flex");
    expect(getInspectorBodyClassName(true).split(" ")).toContain("flex-1");
  });

  it("hides the empty embedded desktop header", () => {
    expect(getInspectorHeaderClassName(true).split(" ")).toContain("lg:hidden");
    expect(getInspectorHeaderClassName(false).split(" ")).not.toContain(
      "lg:hidden"
    );
  });
});
