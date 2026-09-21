import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveConfiguredSkillsDirectory } from "../../src/skills/node-loader.js";

/**
 * `assertSafeDirectory` rejects a blank `skills.directory` by testing
 * `directory.trim()`, but resolved the untrimmed value, so a stray space
 * silently resolved to a sibling directory that does not exist.
 *
 * `root` is resolved rather than written as a literal so the expectations
 * carry a drive letter on Windows, matching the resolved result.
 */
describe("resolveConfiguredSkillsDirectory", () => {
  const root = resolve("/tmp/project");

  it("ignores surrounding whitespace in skills.directory", () => {
    expect(
      resolveConfiguredSkillsDirectory({ directory: " skills" }, root)
    ).toBe(join(root, "skills"));
    expect(
      resolveConfiguredSkillsDirectory({ directory: "skills " }, root)
    ).toBe(join(root, "skills"));
  });

  it("rejects an absolute path even when padded with whitespace", () => {
    for (const directory of ["/etc", " /etc", "/etc "]) {
      expect(() =>
        resolveConfiguredSkillsDirectory({ directory }, root)
      ).toThrow(/non-empty project-relative path/);
    }
  });

  it("keeps the existing behaviour for ordinary and rejected values", () => {
    expect(resolveConfiguredSkillsDirectory(undefined, root)).toBe(
      join(root, "skills")
    );
    expect(
      resolveConfiguredSkillsDirectory({ directory: "docs/skills" }, root)
    ).toBe(join(root, "docs", "skills"));
    expect(resolveConfiguredSkillsDirectory(false, root)).toBeUndefined();
    expect(() =>
      resolveConfiguredSkillsDirectory({ directory: "   " }, root)
    ).toThrow(/non-empty project-relative path/);
    expect(() =>
      resolveConfiguredSkillsDirectory({ directory: "../outside" }, root)
    ).toThrow(/within the project root/);
  });
});
