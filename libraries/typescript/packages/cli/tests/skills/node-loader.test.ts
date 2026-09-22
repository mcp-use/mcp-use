import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveConfiguredSkillsDirectory } from "../../src/skills/node-loader.js";

describe("resolveConfiguredSkillsDirectory", () => {
  const projectRoot = resolve("project");

  it.each(["skills", " skills ", "\t skills\n"])(
    "normalizes surrounding whitespace in %j",
    (directory) => {
      expect(resolveConfiguredSkillsDirectory({ directory }, projectRoot)).toBe(
        resolve(projectRoot, "skills")
      );
    }
  );

  it("preserves spaces inside the directory name", () => {
    expect(
      resolveConfiguredSkillsDirectory(
        { directory: " my skills " },
        projectRoot
      )
    ).toBe(resolve(projectRoot, "my skills"));
  });

  it.each(["", " ", "\t\n", resolve("skills"), ` ${resolve("skills")} `])(
    "rejects empty or absolute directory %j",
    (directory) => {
      expect(() =>
        resolveConfiguredSkillsDirectory({ directory }, projectRoot)
      ).toThrow("skills.directory must be a non-empty project-relative path");
    }
  );

  it.each(["..", "../skills", " ../skills ", " skills/../../outside "])(
    "rejects traversal outside the project in %j",
    (directory) => {
      expect(() =>
        resolveConfiguredSkillsDirectory({ directory }, projectRoot)
      ).toThrow("skills.directory must stay within the project root");
    }
  );

  it("normalizes a conventional directory override", () => {
    expect(
      resolveConfiguredSkillsDirectory(undefined, projectRoot, " custom ")
    ).toBe(resolve(projectRoot, "custom"));
  });

  it("keeps default discovery and explicit disable unchanged", () => {
    expect(resolveConfiguredSkillsDirectory(undefined, projectRoot)).toBe(
      resolve(projectRoot, "skills")
    );
    expect(resolveConfiguredSkillsDirectory(true, projectRoot)).toBe(
      resolve(projectRoot, "skills")
    );
    expect(
      resolveConfiguredSkillsDirectory(false, projectRoot)
    ).toBeUndefined();
  });
});
