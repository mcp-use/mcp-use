import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { findNote } from "./notes.js";

/** Create demo copies and recognize only regular files inside one fixed directory. */
export function createDemoFiles(runtimeDirectory = process.cwd()) {
  const root = resolve(runtimeDirectory, ".mcp-use", "notes-demo");

  async function checkRoot() {
    await mkdir(root, { recursive: true });
    // Reject symlinked ancestors as well as a symlinked demo directory.
    if ((await realpath(root)) !== root) {
      throw new Error("The demo directory must not contain symlinks.");
    }
  }

  return {
    /** Fixed absolute directory; there is deliberately no caller-selected path. */
    root,
    /** Create a fresh copy using exclusive creation; existing files are never reset. */
    async create(noteId: string) {
      const note = findNote(noteId);
      await checkRoot();
      const path = join(root, `${note.id}-${randomUUID()}.md`);
      const file = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      );
      try {
        await file.writeFile(note.content, "utf8");
      } finally {
        await file.close();
      }
      return { path, name: path.slice(root.length + 1) };
    },
    /** Check a host-injected identity without reading arbitrary user files. */
    async contains(path: string) {
      if (!isAbsolute(path) || dirname(path) !== root) return false;
      try {
        await checkRoot();
        const info = await lstat(path);
        return (
          info.isFile() &&
          !info.isSymbolicLink() &&
          (await realpath(path)) === path
        );
      } catch {
        return false;
      }
    },
  };
}
