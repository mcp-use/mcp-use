import { describe, expect, it } from "vitest";
import { getCdCommand } from "../utils.js";

describe("getCdCommand", () => {
  it("quotes a directory name that contains spaces", () => {
    expect(getCdCommand("my app")).toBe('cd "my app"');
    expect(getCdCommand("my-app")).toBe("cd my-app");
  });
});
