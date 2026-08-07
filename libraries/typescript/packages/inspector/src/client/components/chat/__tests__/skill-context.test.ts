import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@mcp-use/client/react";
import {
  buildSkillSystemContext,
  createSkillContextConnection,
  READ_SKILL_TOOL,
  READ_SKILL_RESOURCE_TOOL,
} from "../skill-context";

const source = `---\nname: refunds\ndescription: Handle refunds safely\n---\n# Refunds\n`;
const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
const skill: Skill = {
  uri: "skill://shop/refunds/SKILL.md",
  frontmatter: { name: "refunds", description: "Handle refunds safely" },
  resources: [
    { uri: "skill://shop/refunds/SKILL.md", digest },
    {
      uri: "skill://shop/refunds/references/policy.md",
      digest: `sha256:${createHash("sha256").update("policy").digest("hex")}`,
    },
  ],
};

describe("skill chat context", () => {
  it("advertises metadata without eagerly embedding instructions", () => {
    const context = buildSkillSystemContext([skill], "Storefront MCP");
    expect(context).toContain("refunds");
    expect(context).toContain("Handle refunds safely");
    expect(context).toContain(skill.uri);
    expect(context).toContain("Storefront MCP");
    expect(context).not.toContain("# Refunds");
  });

  it("loads and verifies SKILL.md on demand", async () => {
    const readResource = vi.fn(async () => ({
      contents: [{ uri: skill.uri, mimeType: "text/markdown", text: source }],
    }));
    const connection = createSkillContextConnection({
      skills: [skill],
      origin: "Storefront MCP",
      getSkill: async () => ({ skill }),
      readResource,
    });
    const result = await connection!.callTool(READ_SKILL_TOOL, {
      skillUri: skill.uri,
    });
    expect(readResource).toHaveBeenCalledWith(skill.uri);
    expect(result).toMatchObject({
      content: [{ type: "text", text: source }],
      structuredContent: {
        origin: "Storefront MCP",
        skill: {
          name: "refunds",
          description: "Handle refunds safely",
        },
      },
    });
  });

  it("blocks changed bytes", async () => {
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill: async () => ({ skill }),
      readResource: async () => ({
        contents: [{ uri: skill.uri, text: `${source}changed` }],
      }),
    });
    await expect(
      connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri })
    ).rejects.toThrow("digest mismatch");
  });

  it("only reads resources from the refreshed skill manifest", async () => {
    const readResource = vi.fn(async () => ({
      contents: [
        {
          uri: "skill://shop/refunds/references/policy.md",
          text: "policy",
        },
      ],
    }));
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill: async () => ({ skill }),
      readResource,
    });

    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: "skill://shop/refunds/not-listed.md",
      })
    ).rejects.toThrow("not part of the skill manifest");
    expect(readResource).not.toHaveBeenCalled();
  });
});
