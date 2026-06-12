Build an MCP (Model Context Protocol) server using the mcp-use TypeScript SDK (the `mcp-use` npm package): an in-memory notes service.

Requirements:

1. The server must expose exactly these four tools, backed by shared in-memory state (no database, no files):
   - `save_note` — string parameters `id`, `title`, and `content`. Creates the note, or replaces it if a note with that id already exists. Returns a confirmation message that includes the note's id.
   - `get_note` — string parameter `id`. Returns the note; both its title and its content must appear in the response.
   - `list_notes` — no parameters. Returns the titles of all currently stored notes and the total count (the count must appear as a number in the response).
   - `delete_note` — string parameter `id`. Removes the note and returns a confirmation message that includes the note's id.
2. Error contract: when `get_note` or `delete_note` is called with an id that doesn't exist, the tool must not throw — it must return a message containing the exact phrase `not found`.
3. State must persist across tool calls for the lifetime of the server process: a note saved by one call must be visible to later `get_note`/`list_notes` calls, and a deleted note must no longer appear in later responses.
4. All tool input parameters must be validated with typed schemas.
5. The server must serve MCP over streamable HTTP, listening on the port given by the `PORT` environment variable (defaulting to 3000 when unset).
6. The server entry file must be `src/server.ts` or `index.ts`.
7. The project must be TypeScript: it must typecheck cleanly with `npx tsc --noEmit` and be runnable with `npx tsx <entry-file>`.
8. Install any dependencies you need so the project runs as-is.

When you are done, verify your work: typecheck the project, start the server, and exercise the full note lifecycle — save, get, list, delete, and the not-found cases.
