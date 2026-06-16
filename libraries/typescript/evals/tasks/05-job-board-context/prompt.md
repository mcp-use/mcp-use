Build an MCP (Model Context Protocol) server using the mcp-use TypeScript SDK (the `mcp-use` npm package): a small job board where users can browse listings and ask whether they are qualified for the listing they just liked.

Requirements:

1. The server must expose exactly these three tools, backed by shared in-memory state (no database, no files):
   - `browse_jobs` — optional string parameter `search`. Returns the available job listings, including each listing's id, title, company, and key requirements. When `search` is provided, only matching listings should be returned.
   - `like_listing` — string parameter `listingId`. Marks that listing as the user's current liked listing and returns a confirmation message that includes the listing's title.
   - `am_i_qualified` — string parameter `candidateProfile`. Answers the user's vague follow-up question, "Am I qualified for this?", by using the most recently liked listing as "this". This tool must not require a listing id parameter.
2. Error contract:
   - If `like_listing` is called with an unknown listing id, it must not throw — it must return a message containing the exact phrase `not found`.
   - If `am_i_qualified` is called before any listing has been liked, it must not throw — it must return a message containing the exact phrase `no current listing`.
3. State must persist across tool calls for the lifetime of the server process: once `like_listing` marks a listing as current, later `am_i_qualified` calls must assess that listing until a different listing is liked.
4. The `browse_jobs` result must be suitable for a browsable job-board UI. If you build a widget, the widget must keep the AI aware of the selected or liked listing by publishing model context that includes the listing id, title, and key requirements, so a follow-up like "Am I qualified for this?" is unambiguous.
5. All tool input parameters must be validated with typed schemas.
6. The server must serve MCP over streamable HTTP, listening on the port given by the `PORT` environment variable (defaulting to 3000 when unset).
7. The server entry file must be `src/server.ts` or `index.ts`.
8. The project must be TypeScript: it must typecheck cleanly with `npx tsc --noEmit` and be runnable with `npx tsx <entry-file>`.
9. Install any dependencies you need so the project runs as-is.

Seed the job board with at least these listings:

- id `frontend-platform`, title `Frontend Platform Engineer`, company `Northstar Labs`, requirements including React, TypeScript, accessibility, design systems, and testing.
- id `data-product-analyst`, title `Data Product Analyst`, company `Beacon Health`, requirements including SQL, Python, dashboards, experimentation, and stakeholder communication.
- id `developer-advocate`, title `Developer Advocate`, company `Orbit API`, requirements including TypeScript, technical writing, demos, community, and public speaking.

When you are done, verify your work: typecheck the project, start the server, browse jobs, like a listing, ask `am_i_qualified` without passing a listing id, switch to another listing, and confirm the answer changes.
