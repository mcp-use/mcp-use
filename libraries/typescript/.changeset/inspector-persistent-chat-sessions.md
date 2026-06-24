---
"@mcp-use/inspector": minor
---

feat(inspector): add persistent multi-session chat with history sidebar

Introduces a full multi-session chat system to MCP Inspector, backed by
IndexedDB, replacing the previous single ephemeral chat session that was
lost on every page refresh.

**New features:**

- **Persistent chat sessions** — sessions survive page refreshes and browser
  restarts, stored locally in IndexedDB via `idb-keyval`
- **Normalized storage** — session metadata and messages are stored in
  separate IndexedDB stores to keep session list rendering fast and avoid
  loading all messages on startup
- **Session history sidebar** (`SidebarLeft`) — dedicated panel with session
  create, switch, delete, and clear-all (with confirmation)
- **Inline session naming** — user names a session before it is created,
  avoiding unnamed "New Chat" clutter
- **Storage usage indicator** — live IndexedDB quota bar with an amber warning
  when usage exceeds 80% of quota
- **Stale message prevention** — messages are cleared immediately when
  switching sessions so stale content never appears
- **Auto-recovery** — if all sessions are deleted, a fresh session is
  automatically created

**UI cleanup:**

- Removed `SidebarRight` component; configuration surfaced contextually
- Deduplicated controls previously split between `LayoutHeader` and `ChatTab`
- Session sidebar is hidden when no MCP server is connected
