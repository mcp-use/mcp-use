import type { McpServer } from "@mcp-use/client/react";
import { describe, expect, it } from "vitest";
import {
  getSkillsState,
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
});
