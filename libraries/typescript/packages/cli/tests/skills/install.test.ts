import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";

test("skills install writes the bundled Cloud skill for all supported agents and preserves other skills", async ({
  cli,
}) => {
  const unrelated = join(cli.cwd, ".agents", "skills", "custom", "SKILL.md");
  await mkdir(join(cli.cwd, ".agents", "skills", "custom"), {
    recursive: true,
  });
  await writeFile(unrelated, "custom guidance");

  const result = await cli.run(["skills", "install", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toMatchObject({
    path: cli.cwd,
    skills: expect.arrayContaining([
      "manufact-cloud",
      "manufact-analytics",
      "mcp-apps-builder",
    ]),
  });
  for (const agent of [".cursor", ".claude", ".agents"]) {
    expect(
      await readFile(
        join(cli.cwd, agent, "skills", "manufact-analytics", "SKILL.md"),
        "utf8"
      )
    ).toContain("name: manufact-analytics");
    expect(
      await readFile(
        join(
          cli.cwd,
          agent,
          "skills",
          "manufact-analytics",
          "references",
          "queries.md"
        ),
        "utf8"
      )
    ).toContain("uniqCombined64Merge");
    const source = await readFile(
      join(cli.cwd, agent, "skills", "manufact-cloud", "SKILL.md"),
      "utf8"
    );
    expect(source).toContain("name: manufact-cloud");
    expect(source).toContain("mcp-use whoami --json");
    expect(
      await readFile(
        join(
          cli.cwd,
          agent,
          "skills",
          "manufact-cloud",
          "references",
          "alerts.md"
        ),
        "utf8"
      )
    ).toContain("trigger:");
  }
  expect(await readFile(unrelated, "utf8")).toBe("custom guidance");
});

test("skills add installs into the explicitly selected project", async ({
  cli,
}) => {
  const target = join(cli.cwd, "other");
  await mkdir(target);
  const result = await cli.run(["skills", "add", "--path", target, "--json"]);
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ path: target });
  expect(
    await readFile(
      join(target, ".agents", "skills", "manufact-cloud", "SKILL.md"),
      "utf8"
    )
  ).toContain("name: manufact-cloud");
});
