import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@mcp-use/client/react";
import {
  buildSkillSystemContext,
  createSkillContextConnection,
  filterDisabledSkillHistory,
  READ_SKILL_TOOL,
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
    const context = buildSkillSystemContext([skill], new Set([skill.uri]));
    expect(context).toContain("refunds");
    expect(context).toContain("Handle refunds safely");
    expect(context).not.toContain("# Refunds");
  });

  it("loads and verifies SKILL.md on demand", async () => {
    const readResource = vi.fn(async () => ({
      contents: [{ uri: skill.uri, mimeType: "text/markdown", text: source }],
    }));
    const connection = createSkillContextConnection({
      skills: [skill],
      enabledUris: new Set([skill.uri]),
      getSkill: async () => ({ skill }),
      readResource,
    });
    const result = await connection!.callTool(READ_SKILL_TOOL, {
      skillUri: skill.uri,
    });
    expect(readResource).toHaveBeenCalledWith(skill.uri);
    expect(result).toMatchObject({
      content: [{ type: "text", text: source }],
    });
  });

  it("blocks changed bytes", async () => {
    const connection = createSkillContextConnection({
      skills: [skill],
      enabledUris: new Set([skill.uri]),
      getSkill: async () => ({ skill }),
      readResource: async () => ({
        contents: [{ uri: skill.uri, text: `${source}changed` }],
      }),
    });
    await expect(
      connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri })
    ).rejects.toThrow("digest mismatch");
  });

  it("removes disabled skill tool history from future context", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant" as const,
        content: "",
        timestamp: 1,
        parts: [
          {
            type: "tool-invocation" as const,
            toolInvocation: {
              toolName: READ_SKILL_TOOL,
              args: { skillUri: skill.uri },
              result: { content: [{ type: "text", text: source }] },
            },
          },
        ],
      },
    ];
    expect(filterDisabledSkillHistory(messages, new Set())).toEqual([]);
    expect(
      filterDisabledSkillHistory(messages, new Set([skill.uri]))
    ).toHaveLength(1);
  });
});
