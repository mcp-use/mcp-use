import { describe, expect, it } from "vitest";
import {
  getSkillsCloneArgs,
  SKILLS_AGENT_DIRS,
  SKILLS_BRANCH,
  SKILLS_MANUAL_INSTALL_CMD,
} from "../skills-config.js";

describe("beta skill source configuration", () => {
  it("clones the beta branch explicitly", () => {
    const args = getSkillsCloneArgs("/tmp/skills-repo");
    const branchFlag = args.indexOf("--branch");

    expect(SKILLS_BRANCH).toBe("beta");
    expect(branchFlag).toBeGreaterThan(-1);
    expect(args[branchFlag + 1]).toBe(SKILLS_BRANCH);
    expect(args).toContain("--single-branch");
  });

  it("keeps the manual fallback pinned to beta", () => {
    expect(SKILLS_MANUAL_INSTALL_CMD).toContain("mcp-use/mcp-use#beta");
  });

  it("installs the Codex skill in the standard project directory", () => {
    expect(SKILLS_AGENT_DIRS).toContain(".agents");
    expect(SKILLS_AGENT_DIRS).not.toContain(".agent");
  });
});
