# Python PRs Review & Prioritization

**Generated:** 2026-01-11
**Updated:** 2026-01-12
**Repository:** https://github.com/mcp-use/mcp-use
**Total Python PRs:** 11 (+ 1 your own)

---

## Overview Table

| PR | Title | Author | Age | Size | Priority | Quality | Verdict |
|----|-------|--------|-----|------|----------|---------|---------|
| [#751](https://github.com/mcp-use/mcp-use/pull/751) | Introduce roots support in MCPClient and Server | @Pederzh | 6 days | +507/-24 | **HIGH** | Excellent | ✅ **ENHANCED** |
| [#769](https://github.com/mcp-use/mcp-use/pull/769) | Add init request on server's middleware | @renvins | 1 day | +137/-12 | **HIGH** | Good | **MERGE** |
| [#726](https://github.com/mcp-use/mcp-use/pull/726) | Add timeout to ConnectionManager.stop() | @Incharajayaram | 15 days | +248/-9 | **HIGH** | Good | **MERGE (with fixes)** |
| [#429](https://github.com/mcp-use/mcp-use/pull/429) | LangChain structured output | @renvins | 2+ months | +116/-63 | **MEDIUM** | Good | **MERGE** |
| [#755](https://github.com/mcp-use/mcp-use/pull/755) | LRU caching middleware with TTL | @Irio5 | 5 days | +225/-0 | **MEDIUM** | Needs Work | **REQUEST CHANGES** |
| [#311](https://github.com/mcp-use/mcp-use/pull/311) | Fix Zapier MCP edge case handling | @prasys | 3 months | +5/-0 | **MEDIUM** | Simple | **MERGE** |
| [#468](https://github.com/mcp-use/mcp-use/pull/468) | DevContainer setup | @RohanRusta21 | 2 months | +235/-0 | **LOW** | Needs Cleanup | **OPTIONAL** |
| [#545](https://github.com/mcp-use/mcp-use/pull/545) | Refactor search tools for code mode | @tonxxd | 1.5 months | +920/-42 | **LOW** | Blocked | **DEFER** |
| [#621](https://github.com/mcp-use/mcp-use/pull/621) | Semantic Search Pre-Filtering | @aryasoni98 | 1+ month | +2515/-17 | **LOW** | Needs Review | **DEFER** |
| [#395](https://github.com/mcp-use/mcp-use/pull/395) | Runnable Config changes | @THARUN-S-R | 2.5 months | +341/-8 | **LOW** | Stale | **CLOSE or REVIVE** |
| [#359](https://github.com/mcp-use/mcp-use/pull/359) | Tool call ID management | @harshithvh | 3 months | +268/-10 | **LOW** | Stale | **CLOSE** |

---

## Detailed Analysis

### HIGH PRIORITY - Merge Soon

#### #751 - Introduce roots support in MCPClient and Server ✅ ENHANCED
**Author:** @Pederzh (Luigi Pederzani) | **Labels:** Python
**Status:** Enhanced and Ready | **Branch:** `fix/improve-client-capabilities`

**Original scope:**
- Adds `list_roots_callback` support to all Python connectors (Stdio, HTTP, Sandbox)
- Properly advertises `roots` capability during MCP initialization handshake
- Adds `get_roots()` and `set_roots()` methods to `BaseConnector`
- Exports `Root` type for convenience

**Additional work completed (2026-01-12):**
- Added `roots` and `list_roots_callback` parameters to `MCPClient` constructor
- Added `ctx.list_roots()` method to server `Context` class for requesting roots from clients
- Added `get_client_roots` tool to primitive test server for CI validation
- Created comprehensive integration tests (`test_roots.py`) with 4 test cases
- Updated unit tests for new MCPClient parameters
- Added `roots` to CI workflow primitive test matrix with badge reporting
- Added Roots badge to README alongside other primitives (Tools, Resources, Prompts, Sampling, Elicitation, Auth)
- Created documentation: `docs/python/client/roots.mdx` and `docs/python/server/roots.mdx`
- Added example tool in `context_example.py` and test client `context_example_client.py`
- Fixed async keyword in API reference documentation

**Why it matters:**
- Fixes a real protocol compliance issue - Python library wasn't exposing client capabilities
- Now provides full end-to-end roots support (client configuration → server request → response)
- Matches feature parity with TypeScript implementation

**Commits (6):**
1. `feat(python): add list_roots method to server Context class`
2. `test(python): add get_client_roots tool to primitive server`
3. `feat(python): add roots and list_roots_callback to MCPClient`
4. `test(python): add integration tests for roots capability`
5. `test(python): update unit tests for roots parameters`
6. `ci(python): add roots to primitive tests and README badge`

**Action:** ✅ **READY TO PUSH** - Comprehensive roots support with tests and docs

---

#### #769 - Add init request on server's middleware
**Author:** @renvins (Vincenzo Reina) | **Labels:** Python
**Status:** Review Required | **Added:** +137 | **Deleted:** -12

**What it does:**
- Extends middleware system to support `initialize` lifecycle event
- Implements `MiddlewareServerSession` to capture `initialize` requests at protocol layer
- Adds `on_initialize` hook to `Middleware` base class
- Allows middleware to validate/reject connections during handshake

**Why it matters:**
- Enables important use cases like connection guards and client validation
- Completes the middleware story for the server-side

**Quality Assessment:** Good
- Uses monkey-patching (necessary due to MCP SDK design)
- Clean implementation with proper context passing
- Includes example in middleware_example.py

**Concerns:**
- Monkey-patching `mcp.server.session.ServerSession` could be fragile
- No dedicated unit tests for the new functionality (only example)

**Action:** **MERGE** - Request tests before or after merge

---

#### #726 - Add timeout mechanism to ConnectionManager.stop()
**Author:** @Incharajayaram (Inchara J) | **Labels:** Python
**Status:** Review Required | **Added:** +248 | **Deleted:** -9

**What it does:**
- Adds configurable timeout (default 30s) to `ConnectionManager.stop()`
- Uses `asyncio.wait_for()` for timeout handling
- Force cleanup on timeout to prevent hanging
- Proper error logging

**Why it matters:**
- Fixes real production issue (#562) where app shutdown could hang indefinitely
- Resource leak prevention

**Quality Assessment:** Good
- 10 comprehensive test cases
- Proper async patterns

**Issues flagged by CodeRabbit:**
1. Total timeout could be ~2x expected (timeout applied separately to task wait + done_event wait)
2. Test `test_stop_when_task_not_started` could hang
3. Docstring "Raises: None" is unconventional

**Action:** **MERGE with fixes** - Address CodeRabbit comments first

---

### MEDIUM PRIORITY - Worth Merging

#### #429 - LangChain structured output
**Author:** @renvins (Vincenzo Reina) | **Labels:** Python, agent
**Status:** Review Required | **Added:** +116 | **Deleted:** -63

**What it does:**
- Implements dynamic structured output middleware using `@wrap_model_call`
- Only enforces schema on final turn (not during tool planning)
- Uses LangChain's native `with_structured_output()` for efficiency

**Why it matters:**
- Enables proper structured output without constraining intermediate reasoning
- Closes #397

**Quality Assessment:** Good
- Clean design with deferred schema enforcement
- Includes working example

**Concerns:**
- PR is 2+ months old, may need rebase
- Copilot flagged: first parameter should be `self` not `request` in method

**Action:** **MERGE** - May need rebase to latest main

---

#### #755 - LRU caching middleware with TTL
**Author:** @Irio5 (Ignazio Maria Castrignano) | **Labels:** Python
**Status:** Review Required | **Added:** +225 | **Deleted:** -0

**What it does:**
- Adds `ToolResultCachingMiddleware` with LRU eviction
- TTL-based expiration (default 5 min)
- Deterministic hashing with `sort_keys=True`
- Memory-safe with `max_size` limit

**Why it matters:**
- Reduces redundant API calls for repetitive agent tasks
- Demo shows 15s -> 0s latency improvement

**Quality Assessment:** Needs Work
- **Problem:** Includes junk files that should NOT be merged:
  - `fast_demo.py` in root directory (should be in examples/)
  - `scarf.py` fake library bypass
  - Modified `conftest.py` with unrelated changes
  - `conftest_original.py` backup file
- Core middleware code is actually good
- Tests are comprehensive

**Action:** **REQUEST CHANGES** - Ask contributor to:
1. Remove `fast_demo.py`, `scarf.py`, `conftest_original.py`
2. Restore `conftest.py`
3. Move demo to `examples/server/` if needed
4. Export middleware from `__init__.py`

---

#### #311 - Fix Zapier MCP edge case handling
**Author:** @prasys (Pradeesh) | **Labels:** Python
**Status:** Review Required | **Added:** +5 | **Deleted:** -0

**What it does:**
- Adds URL parsing to detect Zapier MCP server endpoints
- Skips OAuth discovery for pre-authenticated `/s/` endpoints
- Maintains OAuth flow for `/a/` endpoints

**Why it matters:**
- Fixes edge case where OAuth discovery fails for Zapier server-specific URLs
- Small, focused fix

**Quality Assessment:** Simple but adequate
- Only 5 lines added
- Manual testing done by contributor

**Concerns:**
- Very old PR (3 months)
- Only one vendor-specific edge case
- No unit tests

**Action:** **MERGE** - Low risk, fixes real issue

---

### LOW PRIORITY - Consider Carefully

#### #468 - DevContainer setup
**Author:** @RohanRusta21 (Rohan Rustagi) | **Labels:** Python, TypeScript, repo
**Status:** Review Required | **Added:** +235 | **Deleted:** -0

**What it does:**
- Adds `.devcontainer/devcontainer.json` configuration
- Adds `setup.sh` for automated dependency installation
- Python 3.12 + Node.js 20 + UV package manager

**Quality Assessment:** Needs cleanup
- Contributor acknowledged Dockerfile shouldn't have been included
- `setup.sh` is comprehensive but may be over-engineered

**Action:** **OPTIONAL** - Nice to have but not critical. Wait for cleanup or skip.

---

#### #545 - Refactor search tools for code mode
**Author:** @tonxxd (Enrico Toniato - Team Member) | **Labels:** Python, TypeScript, client
**Status:** Review Required | **Added:** +920 | **Deleted:** -42

**What it does:**
- Adds configurable semantic search modes: `string_match`, `fuzzy`, `embeddings`
- Introduces `SemanticSearchConfig` within `CodeModeConfig`
- Optional peer deps: `fuse.js` (TS), `thefuzz` (Python)

**Why it matters:**
- Addresses naive search behavior in code mode

**Status:**
- API docs are out of date (CI failing)
- Large cross-language PR

**Action:** **DEFER** - Team member PR, let them drive it

---

#### #621 - Semantic Search Pre-Filtering for Code Mode
**Author:** @aryasoni98 (Arya Soni) | **Labels:** (none)
**Status:** Review Required | **Added:** +2515 | **Deleted:** -17

**What it does:**
- Semantic pre-filtering with reranking for large toolsets (1000+ tools)
- Embedding-based filtering using Qwen3/OpenAI embeddings
- Enum parameter reduction

**Why it matters:**
- Could significantly reduce LLM token usage

**Quality Assessment:** Needs thorough review
- Massive PR (2500+ lines)
- Contains unrelated TypeScript files (test helpers, OAuth tests)
- Some code appears AI-generated
- Maintainer asked for better tests

**Action:** **DEFER** - Too large, overlaps with #545, needs cleanup

---

#### #395 - Runnable Config changes
**Author:** @THARUN-S-R | **Labels:** Python, agent
**Status:** Review Required | **Added:** +341 | **Deleted:** -8

**What it does:**
- Passes Runnable Config to tools without exposing to LLM
- Allows sending sensitive data to tools safely

**Quality Assessment:** Stale
- PR is 2.5 months old
- Was requested to update for LangChain 1.0.0 upgrade
- Has been updated but CI may need checking

**Action:** **CLOSE or REVIVE** - If still relevant, request full refresh to latest main

---

#### #359 - Tool call ID management
**Author:** @harshithvh (Harshith VH) | **Labels:** Python, agent
**Status:** Review Required | **Added:** +268 | **Deleted:** -10

**What it does:**
- Adds UUID-based tool call ID generation
- Creates ToolMessages for proper conversation history

**Quality Assessment:** Stale
- PR is 3 months old
- Reopening of even older #293
- May be outdated with LangChain 1.0 changes

**Action:** **CLOSE** - Too old, needs complete refresh. Ask contributor to reopen if still relevant.

---

### Your Own PR

#### #713 - Server conformance test
**Author:** @pietrozullo (You) | **Labels:** Python
**Status:** Review Required | **Added:** +54 | **Deleted:** -26

**Notes:**
- Conformance tests passing (79% for Python, 96% for TypeScript)
- Shows +6 improvement over main/canary
- Ready to merge when you decide

---

## Recommended Action Plan

### Completed
1. ✅ **#751 ENHANCED** - Roots support fully implemented with tests, CI, and docs (ready to push)

### Immediate (This Week)
2. **MERGE #769** - Init middleware (after requesting tests)
3. **MERGE #726** - Timeout fix (after addressing CodeRabbit comments)
4. **MERGE #429** - Structured output (may need rebase)
5. **MERGE #311** - Zapier fix (low risk)

### Request Changes
6. **#755** - Caching middleware: Ask to remove junk files

### Close or Defer
7. **CLOSE #359** - Tool call management (too stale)
8. **CLOSE or REVIVE #395** - Runnable Config (check if still relevant)
9. **DEFER #621** - Semantic pre-filtering (too large, overlaps with #545)
10. **DEFER #545** - Let team member drive
11. **OPTIONAL #468** - DevContainer (nice to have, wait for cleanup)

---

## Contributor Quality Notes

| Contributor | PRs | Assessment |
|-------------|-----|------------|
| @Pederzh | #751 | **Excellent** - Professional quality, well-tested |
| @renvins | #769, #429 | **Good** - Consistent contributor, solid code |
| @Incharajayaram | #726 | **Good** - First-time contributor, responsive |
| @Irio5 | #755 | **Needs guidance** - Good core code, poor PR hygiene |
| @prasys | #311 | **Adequate** - Simple fix, worked |
| @tonxxd | #545 | Team member |
| @aryasoni98 | #621 | **Needs review** - Large AI-assisted PR |
| @THARUN-S-R | #395 | **Stale** - Hasn't updated despite requests |
| @harshithvh | #359 | **Stale** - Very old PR |
| @RohanRusta21 | #468 | **Responsive** - Acknowledged issues, willing to fix |

---

## Documentation Updates (2026-01-12)

The following documentation was created/updated as part of #751 enhancements:

| File | Description |
|------|-------------|
| `docs/python/client/roots.mdx` | Client-side roots configuration guide |
| `docs/python/server/roots.mdx` | Server-side roots usage with `ctx.list_roots()` |
| `docs/python/api-reference/mcp_use_server_context.mdx` | Fixed async keyword for `list_roots` |
| `docs/docs.json` | Added navigation entries for roots pages |
| `libraries/python/README.md` | Added Roots badge to primitives row |
