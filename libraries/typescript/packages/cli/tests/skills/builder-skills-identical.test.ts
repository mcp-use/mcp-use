import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";

const skillsRoot = fileURLToPath(
  new URL("../../../../../../skills/", import.meta.url)
);
const builders = ["mcp-builder", "chatgpt-app-builder", "mcp-apps-builder"];

async function references(skill: string): Promise<Record<string, string>> {
  const dir = join(skillsRoot, skill, "references");
  const files = (await readdir(dir)).sort();
  const entries = await Promise.all(
    files.map(async (file) => [file, await readFile(join(dir, file), "utf8")])
  );
  return Object.fromEntries(entries);
}

test("the three builder skills ship byte-identical references, including events.md", async () => {
  const [base, ...others] = await Promise.all(builders.map(references));

  expect(Object.keys(base!)).toContain("events.md");
  for (const other of others) {
    expect(other).toEqual(base);
  }
});

test("each builder skill routes to the events reference", async () => {
  for (const skill of builders) {
    const text = await readFile(join(skillsRoot, skill, "SKILL.md"), "utf8");
    expect(text).toContain("[Events](references/events.md)");
  }
});
