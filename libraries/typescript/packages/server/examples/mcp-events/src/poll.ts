/**
 * Poll consumer for `note.created` (official MCP Events extension, no
 * callback URL needed). Run `pnpm dev` in another terminal, then:
 *
 *   pnpm poll            # all folders
 *   pnpm poll inbox      # one folder
 */
import { MCPClient, pollEvents, type PollResult } from "@mcp-use/client";

const url = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const folder = process.argv[2];

const client = new MCPClient({ mcpServers: { notes: { url } } });
const session = await client.connect("notes");

let cursor: string | null = null;
console.log(`Polling note.created on ${url}${folder ? ` (${folder})` : ""}`);
for (;;) {
  let page: PollResult<{ noteId: string; title: string }>;
  try {
    page = await pollEvents<{ noteId: string; title: string }>(session, {
      name: "note.created",
      arguments: folder ? { folder } : {},
      cursor,
    });
  } catch (error) {
    // Keep the cursor and retry; a restart would replay from the beginning.
    console.error("Poll failed, retrying in 5s:", error);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }
  if (page.truncated) console.warn("Some events may have been missed.");
  for (const event of page.events)
    console.log(`${event.timestamp} ${event.data.noteId}: ${event.data.title}`);
  cursor = page.cursor;
  if (!page.hasMore)
    await new Promise((r) => setTimeout(r, Math.max(page.nextPollMs, 1000)));
}
