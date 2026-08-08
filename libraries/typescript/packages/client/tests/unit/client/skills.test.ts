import { describe, expect, it, vi } from "vitest";
import { MCPConnection } from "../../../src/core/session.js";

describe("Skills over MCP client operations", () => {
  it("paginates the complete catalog through the raw extension method", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        skills: [
          { uri: "skill://one/SKILL.md", frontmatter: {}, resources: [] },
        ],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        skills: [
          { uri: "skill://two/SKILL.md", frontmatter: {}, resources: [] },
        ],
      });
    const connection = new MCPConnection({ request } as never);

    await expect(connection.listAllSkills()).resolves.toMatchObject({
      skills: [
        { uri: "skill://one/SKILL.md" },
        { uri: "skill://two/SKILL.md" },
      ],
    });
    expect(request).toHaveBeenNthCalledWith(1, "skills/list", {}, undefined);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "skills/list",
      { cursor: "page-2" },
      undefined
    );
  });

  it("fails closed on repeated pagination cursors", async () => {
    const request = vi.fn().mockResolvedValue({
      skills: [],
      nextCursor: "same",
    });
    const connection = new MCPConnection({ request } as never);
    await expect(connection.listAllSkills()).rejects.toThrow(
      "repeated pagination cursor"
    );
  });

  it("addresses skills and directories by URI", async () => {
    const request = vi.fn().mockResolvedValue({});
    const connection = new MCPConnection({ request } as never);
    await connection.getSkill("skill://one/SKILL.md");
    await connection.readResourceDirectory("skill://one/references", "next");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "skills/get",
      { uri: "skill://one/SKILL.md" },
      undefined
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "resources/directory/read",
      { uri: "skill://one/references", cursor: "next" },
      undefined
    );
  });
});
