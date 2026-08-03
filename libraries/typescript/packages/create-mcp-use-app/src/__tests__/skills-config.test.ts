import { describe, expect, it } from "vitest";
import {
  getDefaultDistTag,
  getSkillsCloneArgs,
  getSkillsBranch,
  getSkillsManualInstallCommand,
  SKILLS_AGENT_DIRS,
} from "../skills-config.js";

describe("release-channel configuration", () => {
  it.each([
    ["2.0.0-beta.15", "beta", "beta"],
    ["2.0.0", "latest", "main"],
  ] as const)(
    "maps create-mcp-use-app@%s to npm %s and skill branch %s",
    (version, distTag, branch) => {
      expect(getDefaultDistTag(version)).toBe(distTag);
      expect(getSkillsBranch(version)).toBe(branch);
      expect(getSkillsManualInstallCommand(version)).toContain(
        `mcp-use/mcp-use#${branch}`
      );
    }
  );

  it("clones the release-appropriate branch explicitly", () => {
    const args = getSkillsCloneArgs("/tmp/skills-repo", "2.0.0");
    const branchFlag = args.indexOf("--branch");

    expect(branchFlag).toBeGreaterThan(-1);
    expect(args[branchFlag + 1]).toBe("main");
    expect(args).toContain("--single-branch");
  });

  it("installs the Codex skill in the standard project directory", () => {
    expect(SKILLS_AGENT_DIRS).toContain(".agents");
    expect(SKILLS_AGENT_DIRS).not.toContain(".agent");
  });
});
