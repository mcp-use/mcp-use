import type { ResourceLink } from "mcp-use";

/** Bundled, immutable notes used by the catalog, resolver, and demo creator. */
export const notes = [
  {
    id: "welcome",
    title: "Welcome",
    description: "Try composer mentions and open a Markdown demo file.",
    content:
      "# Welcome\n\nMention a note in the composer, or create a demo file to edit.\n",
  },
  {
    id: "packing-list",
    title: "Packing list",
    description: "A short travel checklist.",
    content: "# Packing list\n\n- Passport\n- Charger\n- Notebook\n",
  },
  {
    id: "meeting-notes",
    title: "Meeting notes",
    description: "A small agenda for the next team meeting.",
    content:
      "# Meeting notes\n\n## Agenda\n\n- Review the demo\n- Collect feedback\n",
  },
] as const;

/** Find only a bundled note; arbitrary paths and unknown IDs are rejected. */
export function findNote(id: string) {
  const note = notes.find((item) => item.id === id);
  if (!note) throw new Error("Unknown sample note.");
  return note;
}

/** Return resource links whose exact URIs have app-owned resource resolvers. */
export function searchNotes(query: string): ResourceLink[] {
  const needle = query.trim().toLocaleLowerCase("en");
  return notes
    .filter((note) =>
      `${note.title} ${note.description} ${note.content}`
        .toLocaleLowerCase("en")
        .includes(needle)
    )
    .map((note) => ({
      type: "resource_link" as const,
      uri: `notes://catalog/${note.id}`,
      name: note.id,
      title: note.title,
      description: note.description,
      mimeType: "text/markdown",
    }));
}
