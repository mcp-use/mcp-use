import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDemoFiles } from "../src/demo-files.js";
import { findNote, notes, searchNotes } from "../src/notes.js";

const temporaryDirectories: string[] = [];
async function fixture() {
  const runtime = await mkdtemp(join(tmpdir(), "markdown-notes-"));
  temporaryDirectories.push(runtime);
  return { runtime, files: createDemoFiles(runtime) };
}
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("bundled note catalog", () => {
  it("supports empty, whitespace, case-insensitive, and missing composer queries", () => {
    expect(searchNotes("")).toHaveLength(3);
    expect(searchNotes("   ")).toEqual(searchNotes(""));
    expect(searchNotes("PACK").map((item) => item.name)).toEqual([
      "packing-list",
    ]);
    expect(searchNotes("not-a-note")).toEqual([]);
  });
  it("returns legitimate links matching the app's exact resolver URIs", () => {
    for (const link of searchNotes("")) {
      const note = findNote(link.name);
      expect(link).toMatchObject({
        type: "resource_link",
        uri: `notes://catalog/${note.id}`,
        title: note.title,
        mimeType: "text/markdown",
      });
    }
    expect(notes).toHaveLength(3);
  });
});

describe("real temporary filesystem fixtures (no desktop host)", () => {
  it("creates absolute, private, distinct copies without overwriting edits", async () => {
    const { files } = await fixture();
    const first = await files.create("welcome");
    expect(isAbsolute(first.path)).toBe(true);
    expect((await stat(first.path)).mode & 0o777).toBe(0o600);
    expect(await files.contains(first.path)).toBe(true);
    expect(await readFile(first.path, "utf8")).toBe(
      findNote("welcome").content
    );
    await writeFile(first.path, "Keep my edit.");
    const second = await files.create("welcome");
    expect(second.path).not.toBe(first.path);
    expect(await readFile(first.path, "utf8")).toBe("Keep my edit.");
  });
  it("rejects arbitrary IDs, traversal, outside files, directories, and symlinks", async () => {
    const { runtime, files } = await fixture();
    await expect(files.create("../../escape")).rejects.toThrow(
      "Unknown sample note"
    );
    const copy = await files.create("welcome");
    const outside = join(runtime, "outside.md");
    await writeFile(outside, "outside");
    expect(await files.contains(outside)).toBe(false);
    expect(await files.contains(files.root)).toBe(false);
    expect(await files.contains("relative.md")).toBe(false);
    const link = join(files.root, "linked.md");
    await symlink(outside, link);
    expect(await files.contains(link)).toBe(false);
    expect(await files.contains(join(files.root, "..", "outside.md"))).toBe(
      false
    );
    expect(await files.contains(copy.path)).toBe(true);
  });
  it("rejects a demo directory replaced by a symlink", async () => {
    const { runtime, files } = await fixture();
    await files.create("welcome");
    await rm(files.root, { recursive: true });
    await symlink(runtime, files.root);
    await expect(files.create("welcome")).rejects.toThrow("symlinks");
  });
});
