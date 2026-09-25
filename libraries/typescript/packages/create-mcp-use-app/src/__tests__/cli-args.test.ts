import { describe, expect, it } from "vitest";
import { parseCli } from "../cli-args.js";

describe("CLI arguments", () => {
  it("rejects a misspelled option before selecting the default template", () => {
    expect(() => parseCli(["my-project", "--templat", "mcp-apps"])).toThrow(
      "Unknown option '--templat'"
    );
  });

  it("rejects a second project name", () => {
    expect(() => parseCli(["my-project", "other-project"])).toThrow(
      "Unexpected extra argument: other-project"
    );
  });

  it("accepts the documented negative flags", () => {
    const parsed = parseCli(["my-project", "--no-install", "--no-skills"]);
    expect(parsed.projectName).toBe("my-project");
    expect(parsed.options.install).toBe(false);
    expect(parsed.options.skills).toBe(false);
  });
});
