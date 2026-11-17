import { describe, expect, it } from "vitest";
import { validateProjectName } from "../utils.js";

describe("validateProjectName", () => {
  it("accepts letters, numbers, hyphens and underscores", () => {
    for (const name of ["my-app", "my_app", "MyApp2", "a"]) {
      expect(validateProjectName(name)).toBeUndefined();
    }
  });

  it("rejects names that would need quoting in a `cd` hint", () => {
    for (const name of ["my app", "foo&bar", "a (b)", "a$b", 'my "app"']) {
      expect(validateProjectName(name)).toMatch(
        /can only contain letters, numbers, hyphens, and underscores/
      );
    }
  });

  it("rejects path separators, '..' and dots", () => {
    for (const name of [
      "apps/server",
      "apps\\server",
      "..",
      "../x",
      "my.app",
    ]) {
      expect(validateProjectName(name)).toBeDefined();
    }
  });

  it("suggests a valid name", () => {
    expect(validateProjectName("my app")).toContain('Try "my-app".');
    expect(validateProjectName("  My  Cool App! ")).toContain(
      'Try "My-Cool-App".'
    );
    expect(validateProjectName("...")).not.toContain("Try");
  });

  it("rejects a leading hyphen, which `cd` would parse as an option", () => {
    expect(validateProjectName("-foo")).toBe(
      'Project name cannot start with a hyphen. Try "foo".'
    );
    expect(validateProjectName("-")).toBe(
      "Project name cannot start with a hyphen."
    );
    expect(validateProjectName("foo-")).toBeUndefined();
    expect(validateProjectName("_foo")).toBeUndefined();
  });
});
