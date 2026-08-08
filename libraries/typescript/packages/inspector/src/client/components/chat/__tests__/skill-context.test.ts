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

const policyUri = "skill://shop/refunds/references/policy.md";

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
    const staleResourceUri = "skill://shop/refunds/references/stale.md";
    const catalogSkill: Skill = {
      ...skill,
      resources: [
        skill.resources![0],
        {
          uri: staleResourceUri,
          digest: `sha256:${createHash("sha256").update("stale").digest("hex")}`,
        },
      ],
    };
    const refreshedSkill: Skill = {
      ...skill,
      resources: [skill.resources![0], skill.resources![1]],
    };
    const readResource = vi.fn(async (uri: string) => ({
      contents: [
        uri === skill.uri
          ? { uri, mimeType: "text/markdown", text: source }
          : { uri, text: "policy" },
      ],
    }));
    const connection = createSkillContextConnection({
      skills: [catalogSkill],
      getSkill: async () => ({ skill: refreshedSkill }),
      readResource,
    });

    await connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri });

    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: staleResourceUri,
      })
    ).rejects.toThrow("not part of the skill manifest");
    expect(readResource).toHaveBeenCalledTimes(1);

    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: policyUri,
      })
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "policy" }],
    });
  });

  it("requires a successful SKILL.md read before reading resources", async () => {
    const getSkill = vi.fn(async () => ({ skill }));
    const readResource = vi.fn();
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill,
      readResource,
    });

    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: policyUri,
      })
    ).rejects.toThrow("Load SKILL.md before reading skill resources");
    expect(getSkill).not.toHaveBeenCalled();
    expect(readResource).not.toHaveBeenCalled();
  });

  it("does not authorize resources when loading SKILL.md fails", async () => {
    const readResource = vi.fn(async () => ({
      contents: [{ uri: skill.uri, text: `${source}changed` }],
    }));
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill: async () => ({ skill }),
      readResource,
    });

    await expect(
      connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri })
    ).rejects.toThrow("digest mismatch");
    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: policyUri,
      })
    ).rejects.toThrow("Load SKILL.md before reading skill resources");
    expect(readResource).toHaveBeenCalledTimes(1);
  });

  it("revokes prior authorization before refreshing SKILL.md", async () => {
    let getSkillCalls = 0;
    const getSkill = vi.fn(async () => {
      getSkillCalls += 1;
      if (getSkillCalls === 2) throw new Error("skills/get failed");
      return { skill };
    });
    const readResource = vi.fn(async () => ({
      contents: [{ uri: skill.uri, text: source }],
    }));
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill,
      readResource,
    });

    await connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri });
    await expect(
      connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri })
    ).rejects.toThrow("skills/get failed");
    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: policyUri,
      })
    ).rejects.toThrow("Load SKILL.md before reading skill resources");
    expect(getSkill).toHaveBeenCalledTimes(2);
    expect(readResource).toHaveBeenCalledTimes(1);
  });

  it("requires a reload when the SKILL.md digest changes", async () => {
    const changedSource = `${source}\nUpdated instructions\n`;
    const changedSkill: Skill = {
      ...skill,
      resources: [
        {
          uri: skill.uri,
          digest: `sha256:${createHash("sha256").update(changedSource).digest("hex")}`,
        },
        skill.resources![1],
      ],
    };
    let currentSkill = skill;
    const readResource = vi.fn(async (uri: string) => ({
      contents: [{ uri, text: source }],
    }));
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill: async () => ({ skill: currentSkill }),
      readResource,
    });

    await connection!.callTool(READ_SKILL_TOOL, { skillUri: skill.uri });
    currentSkill = changedSkill;

    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
        resourceUri: policyUri,
      })
    ).rejects.toThrow("instructions changed; reload SKILL.md");
    expect(readResource).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown tools and malformed arguments before fetching", async () => {
    const getSkill = vi.fn(async () => ({ skill }));
    const readResource = vi.fn();
    const connection = createSkillContextConnection({
      skills: [skill],
      getSkill,
      readResource,
    });

    await expect(
      connection!.callTool("unknown", { skillUri: skill.uri })
    ).rejects.toThrow("Unknown skill host tool");
    await expect(
      connection!.callTool(READ_SKILL_RESOURCE_TOOL, {
        skillUri: skill.uri,
      })
    ).rejects.toThrow("resourceUri must be a string");
    expect(getSkill).not.toHaveBeenCalled();
    expect(readResource).not.toHaveBeenCalled();
  });
});
