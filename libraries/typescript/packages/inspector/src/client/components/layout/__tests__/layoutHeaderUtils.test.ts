import type { McpServer } from "@mcp-use/client/react";
import { describe, expect, it } from "vitest";
import {
  getSkillsAccessibleLabel,
  getSkillsFallbackTab,
  getSkillsState,
  isTabUsable,
  SKILLS_EMPTY_CATALOG_MESSAGE,
  SKILLS_UNSUPPORTED_MESSAGE,
  supportsSkills,
} from "../layoutHeaderUtils";

function server(overrides: Partial<McpServer>): McpServer {
  return overrides as McpServer;
}

describe("Skills navigation state", () => {
  it("is disabled when the server does not advertise the extension", () => {
    const value = server({ extensions: {} });

    expect(supportsSkills(value)).toBe(false);
    expect(getSkillsState(value)).toBe("unsupported");
    expect(SKILLS_UNSUPPORTED_MESSAGE).toContain("Skills over MCP");
  });

  it("treats an advertised empty catalog as unavailable", () => {
    const value = server({
      extensions: { "io.modelcontextprotocol/skills": {} },
      skills: [],
    });

    expect(supportsSkills(value)).toBe(true);
    expect(getSkillsState(value)).toBe("empty");
    expect(SKILLS_EMPTY_CATALOG_MESSAGE).toContain("empty catalog");
  });

  it("treats an advertised populated catalog as available", () => {
    const value = server({
      extensions: { "io.modelcontextprotocol/skills": {} },
      skills: [{ uri: "skill://refunds/SKILL.md" }] as McpServer["skills"],
    });

    expect(getSkillsState(value)).toBe("available");
  });

  it("announces only the advertised-empty status in the accessible label", () => {
    expect(getSkillsAccessibleLabel("Skills", "empty")).toBe(
      "Skills: advertised but empty"
    );
    expect(getSkillsAccessibleLabel("Skills", "available")).toBe("Skills");
    expect(getSkillsAccessibleLabel("Skills", "unsupported")).toBe("Skills");
  });

  it("preserves Tools as the default fallback", () => {
    const value = server({
      extensions: {},
      protocolEra: "legacy",
      state: "ready",
    });

    expect(getSkillsFallbackTab(value)).toBe("tools");
  });

  it("chooses the first visible usable fallback", () => {
    const value = server({
      extensions: {},
      protocolEra: "modern",
      state: "ready",
    });

    expect(
      getSkillsFallbackTab(value, ["skills", "sampling", "resources"])
    ).toBe("resources");
    expect(isTabUsable("skills", value)).toBe(false);
    expect(isTabUsable("sampling", value)).toBe(false);
    expect(isTabUsable("resources", value)).toBe(true);
  });

  it("does not redirect when no visible tab is usable", () => {
    const value = server({
      extensions: {},
      protocolEra: "modern",
      state: "ready",
    });

    expect(getSkillsFallbackTab(value, ["skills", "sampling"])).toBeNull();
    expect(getSkillsFallbackTab(value, [])).toBeNull();
  });

  it("does not redirect while the server is still discovering Skills", () => {
    const value = server({
      extensions: {},
      protocolEra: "legacy",
      state: "discovering",
    });

    expect(getSkillsFallbackTab(value)).toBeNull();
  });

  it("does not redirect when the ready server has available Skills", () => {
    const value = server({
      extensions: { "io.modelcontextprotocol/skills": {} },
      skills: [{ uri: "skill://refunds/SKILL.md" }] as McpServer["skills"],
      protocolEra: "legacy",
      state: "ready",
    });

    expect(getSkillsFallbackTab(value)).toBeNull();
  });
});
