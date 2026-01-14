# MCP-Use GitHub Issues Analysis

> Generated: 2026-01-12

## Issues Overview

| # | Title | Labels | Importance | Fix Ideas |
|---|-------|--------|------------|-----------|
| **734** | TypeError: cannot pickle '_asyncio.Future' object | bug, Python, agent, client | **Critical** | User cannot use mcp-use on cloud deployments. Need to investigate async context handling when using threading. May need to provide synchronous wrappers that properly manage event loops. |
| **562** | Infinite Wait in ConnectionManager.stop() | bug, Python, client, good first issue | **High** | Add timeout logic to `stop()` method. PR #680 already submitted - needs review. Ensure graceful shutdown with fallback force-close after timeout. |
| **626** | Error listing prompts for streamable HTTP and LangGraph blocking | bug, Python, ready | **High** | Issues with connector prompts and LangGraph integration. Needs investigation into HTTP connector implementation. |
| **404** | Unable to set timeout for connection to MCP Server | bug, Python | **High** | PR already exists. Pass timeout parameter through StdioConnector to StdioConnectionManager. Use `asyncio.wait_for()` for connection establishment. |
| **472** | Reasoning output concatenates JSON (OpenAI Responses API) | bug, Python | **High** | Update `_normalize_output()` to handle OpenAI Responses API v1 format. Skip non-text blocks (reasoning, thinking). User provided fix code in comments. |
| **709** | Package splitting for mcp-use(TS) v2.0 | RFC, feature, TS | **High** | Split TypeScript package into core + UI optional dependencies. Reduces bundle size for users who don't need UI components. Architectural RFC. |
| **754** | Add Caching Middleware to Python SDK | enhancement, Python, ready | **Medium** | Enhancement ready for implementation. Add middleware layer for caching MCP responses to improve performance. |
| **629** | Allow passing checkpointer to MCPAgent | enhancement, Python, agent | **Medium** | Add checkpointer support to maintain conversational state across API calls. Would enable interrupt/resume patterns and human approval workflows. |
| **542** | Semantic Search Pre-Filtering for Code Mode | enhancement, Python, planned | **Medium** | Implement 3 search modes: 1) Naive string matching (current), 2) Semantic search via external APIs, 3) Fuzzy matching. Someone assigned. |
| **719** | Convert STDIO to SSE transport | feature, Python, good first issue | **Medium** | Suggested workaround: use [supergateway](https://github.com/supercorp-ai/supergateway). Could build native adapter for STDIO→SSE conversion. |
| **309** | Zapier MCP Server OAuth discovery issue | bug | **Medium** | Related to auth system update in #518. Server-specific URLs triggering unexpected OAuth discovery flow. |
| **770** | Refactor complex nested loops in streaming logic | bug, Python, TS, agent | **Low** | Code quality improvement. Simplify nested loop structures in agent streaming for maintainability. |
| **771** | Replace magic numbers with named constants | bug, documentation, Python, TS | **Low** | Code quality. Extract hardcoded values to named constants/config. Good for maintainability. |
| **772** | Add focused utility functions | bug, Python, TS, agent | **Low** | Code organization refactor. Break large functions into smaller, testable units. |
| **484** | How can I reuse the session | Python, ready | **Low** | Documentation/support issue. User needs guidance on session reuse pattern. Create example in docs. |
| **305** | Is there a way to control chat history? | question | **Low** | Documentation issue. Need to document memory/history management APIs. |
| **262** | I wish mcp-use had... | wishlist | **Info** | Collection of feature requests: tool call tracking, visualization APIs, plug-and-play MCP servers, inspector toggle. Good source for roadmap. |
| **793** | Link Checker Report | automated | **Info** | Automated CI report. Fix broken documentation links. |

---

## Summary by Priority

### Critical (1 issue)
- **#734** - Async pickling issue blocks cloud deployments

### High (5 issues)
- **#562** - Infinite wait in ConnectionManager.stop()
- **#626** - Error listing prompts for streamable HTTP
- **#404** - Unable to set timeout for MCP Server connection
- **#472** - OpenAI Responses API compatibility
- **#709** - TypeScript package splitting RFC

### Medium (5 issues)
- **#754** - Caching middleware for Python SDK
- **#629** - Checkpointer support for MCPAgent
- **#542** - Semantic search pre-filtering
- **#719** - STDIO to SSE transport conversion
- **#309** - Zapier OAuth discovery issue

### Low (6 issues)
- **#770** - Refactor streaming logic
- **#771** - Replace magic numbers
- **#772** - Add utility functions
- **#484** - Session reuse documentation
- **#305** - Chat history documentation
- **#262** - Feature wishlist collection

---

## Recommended Next Steps

1. **Prioritize #734** - Cloud deployment blocker affecting multiple users
2. **Review existing PRs** - #680 (for #562), timeout PR (for #404)
3. **Apply user-provided fix** for #472 (OpenAI Responses API)
4. **Plan TypeScript v2.0** architecture (#709) with package splitting
5. **Improve documentation** for session reuse and chat history management

---

## Deep Dive: Issue #734 - TypeError: cannot pickle '_asyncio.Future' object

### Summary

Users cannot use mcp-use on cloud deployments (e.g., Cloud Foundry). The error occurs when Pydantic attempts to deepcopy a `BaseConnector` object that contains unpicklable `asyncio.Future` objects.

### Error Message

```
TypeError: cannot pickle '_asyncio.Future' object
```

### Stack Trace Analysis

```
mcpagent.py:887    → run()
mcpagent.py:414    → _consume_and_return()
mcpagent.py:490    → stream() → initialize()
mcpagent.py:189    → initialize() creates tools via adapter
base.py:69         → create_tools()
base.py:155        → _create_tools_from_connectors()
base.py:96         → load_tools_for_connector() → _convert_tool()
langchain_adapter.py:77 → _convert_tool() creating McpToLangChainAdapter(BaseTool)
pydantic/v1/fields.py:437 → get_default() calls smart_deepcopy()
copy.py:172        → deepcopy() fails on asyncio.Future
```

### Root Cause

The issue is in `langchain_adapter.py:66-74`:

```python
class McpToLangChainAdapter(BaseTool):
    name: str = mcp_tool.name or "NO NAME"
    description: str = mcp_tool.description or ""
    args_schema: type[BaseModel] = jsonschema_to_pydantic(...)
    tool_connector: BaseConnector = connector  # <-- PROBLEM HERE
    handle_tool_error: bool = True
```

When Pydantic v1 (used by LangChain's `BaseTool`) creates this dynamically-defined class:

1. Pydantic creates model fields for class attributes with default values
2. For `tool_connector: BaseConnector = connector`, Pydantic calls `smart_deepcopy(connector)`
3. The `connector` object contains unpicklable async primitives:
   - `_connection_manager.ConnectionManager` has:
     - `_ready_event: asyncio.Event`
     - `_done_event: asyncio.Event`
     - `_stop_event: asyncio.Event`
     - `_task: asyncio.Task` (contains Future objects)
   - `client_session: ClientSession` (also contains async primitives)
4. `deepcopy()` fails because `asyncio.Future` cannot be pickled

### Why It Works Locally But Not on Cloud

**Local execution:**
- The connector may not be fully connected when tools are created
- `_connection_manager` is `None`, so no async primitives to deepcopy

**Cloud execution (user's pattern):**
```python
class mcpUseWrapper:
    def __init__(self, servers_config: str):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_event_loop, daemon=True)
        self.thread.start()
        client = MCPClient(servers_config)
        llm = ChatOpenAI(...)
        self.agent = MCPAgent(llm=llm, client=client, ...)

    def run(self, prompt: str):
        future = asyncio.run_coroutine_threadsafe(self.agent.run(prompt), self.loop)
        return future.result()
```

- Connector gets fully connected before tool creation
- `_connection_manager` exists with all async primitives
- Deepcopy fails on the populated async objects

### Proposed Solutions

#### Option 1: Use Closure Instead of Class Attribute (Recommended)

Store connector in closure scope instead of as a Pydantic field:

```python
def _convert_tool(self, mcp_tool: MCPTool, connector: BaseConnector) -> BaseTool | None:
    adapter_self = self
    _connector = connector  # Capture in closure

    class McpToLangChainAdapter(BaseTool):
        name: str = mcp_tool.name or "NO NAME"
        description: str = mcp_tool.description or ""
        args_schema: type[BaseModel] = jsonschema_to_pydantic(...)
        handle_tool_error: bool = True

        # Don't define tool_connector as class attribute

        async def _arun(self, **kwargs: Any) -> str | dict:
            # Access connector from closure
            result = await _connector.call_tool(self.name, kwargs)
            return str(result.content)

    return McpToLangChainAdapter()
```

**Pros:** Simple, no Pydantic field deepcopy triggered
**Cons:** Connector not accessible via `self.tool_connector`

#### Option 2: Use Pydantic's `model_config` to Exclude Field

```python
class McpToLangChainAdapter(BaseTool):
    model_config = {"arbitrary_types_allowed": True}

    name: str = mcp_tool.name or "NO NAME"
    description: str = mcp_tool.description or ""
    tool_connector: BaseConnector = Field(default=connector, exclude=True)
```

**Note:** This may not fully work with Pydantic v1 which LangChain uses.

#### Option 3: Implement `__deepcopy__` on BaseConnector

```python
class BaseConnector(ABC):
    def __deepcopy__(self, memo):
        # Return self instead of deep copying
        # Safe because we don't mutate connector state
        return self
```

**Pros:** Fixes issue at the source
**Cons:** Might have unintended side effects if deepcopy is expected elsewhere

#### Option 4: Use `PrivateAttr` (Pydantic v2 style)

```python
from pydantic import PrivateAttr

class McpToLangChainAdapter(BaseTool):
    _tool_connector: BaseConnector = PrivateAttr()

    def __init__(self, connector: BaseConnector, **data):
        super().__init__(**data)
        self._tool_connector = connector
```

**Cons:** Requires restructuring how the dynamic class is created

### Recommended Fix

**Option 1 (Closure)** is the cleanest solution with minimal code changes:

```python
# In langchain_adapter.py

def _convert_tool(self, mcp_tool: MCPTool, connector: BaseConnector) -> BaseTool | None:
    if mcp_tool.name in self.disallowed_tools:
        return None

    adapter_self = self
    # Capture connector in closure - NOT as a class attribute
    _connector = connector

    class McpToLangChainAdapter(BaseTool):
        name: str = mcp_tool.name or "NO NAME"
        description: str = mcp_tool.description or ""
        args_schema: type[BaseModel] = jsonschema_to_pydantic(
            adapter_self.fix_schema(mcp_tool.inputSchema)
        )
        handle_tool_error: bool = True

        def __repr__(self) -> str:
            return f"MCP tool: {self.name}: {self.description}"

        def _run(self, **kwargs: Any) -> NoReturn:
            raise NotImplementedError("MCP tools only support async operations")

        async def _arun(self, **kwargs: Any) -> str | dict:
            logger.debug(f'MCP tool: "{self.name}" received input: {kwargs}')
            try:
                tool_result: CallToolResult = await _connector.call_tool(self.name, kwargs)
                try:
                    return str(tool_result.content)
                except Exception as e:
                    logger.error(f"Error parsing tool result: {e}")
                    return format_error(e, tool=self.name, tool_content=tool_result.content)
            except Exception as e:
                if self.handle_tool_error:
                    return format_error(e, tool=self.name)
                raise

    return McpToLangChainAdapter()
```

### Files to Modify

1. `libraries/python/mcp_use/agents/adapters/langchain_adapter.py`
   - `_convert_tool()` method (lines 49-117)
   - `_convert_resource()` method (lines 119-158)
   - `_convert_prompt()` method (lines 160-215)

### Testing

1. Create a test that mimics the cloud deployment pattern:
   ```python
   def test_tool_creation_with_connected_connector():
       # Create connector and fully connect it
       # Then create tools - should not raise pickle error
   ```

2. Verify existing tests still pass

3. Test on actual cloud environment (Cloud Foundry, AWS Lambda, etc.)

### Impact

- **Breaking change:** No
- **Risk:** Low - only changes internal implementation
- **Affected users:** All users trying to use mcp-use in cloud/serverless environments

---

## Implementation Status (Option A - StructuredTool)

### Changes Made

**File:** `libraries/python/mcp_use/agents/adapters/langchain_adapter.py`

Refactored all three conversion methods to use `StructuredTool.from_function()`:

1. **`_convert_tool()`** - Uses closure to capture connector, calls `StructuredTool.from_function()` with async coroutine
2. **`_convert_resource()`** - Same pattern for resource tools
3. **`_convert_prompt()`** - Same pattern for prompt tools

**Key changes:**
- Removed dynamic class creation (`class McpToLangChainAdapter(BaseTool)`)
- Connector captured in closure (`_connector = connector`) instead of class attribute
- Uses `StructuredTool.from_function(coroutine=..., args_schema=...)`
- Removed unused imports (`NoReturn`, `ReadResourceRequestParams`)

### Test Results

```
Unit tests:     169 passed, 1 failed (unrelated sandbox test)
Integration:    6 passed (all agent tests)
New tests:      6 passed (test_langchain_adapter_pickle.py)
Linting:        All checks passed
```

### New Test File

Created `tests/unit/test_langchain_adapter_pickle.py` with tests that verify:
- Tool creation doesn't trigger Pydantic deepcopy of connector
- Tools don't expose `tool_connector` attribute
- Multiple tools can share same connector via closure
- Tool execution correctly uses connector from closure
- Different tools use their respective connectors
