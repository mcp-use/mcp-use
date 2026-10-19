import { describe, expect, it } from "vitest";
import { getCdCommand } from "../utils.js";

describe("getCdCommand", () => {
  it("quotes a directory name with spaces or shell operators", () => {
    expect(getCdCommand("my app")).toBe('cd "my app"');
    expect(getCdCommand("foo&bar")).toBe('cd "foo&bar"');
    expect(getCdCommand("my-app")).toBe("cd my-app");
  });
});
