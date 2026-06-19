"""
Unit tests for CodeExecutor.

Tests the code execution functionality for MCP code mode.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from mcp_use.client.client import MCPClient
from mcp_use.client.code_executor import CodeExecutor
from mcp_use.client.executors.vm import InsecureCodeExecutionWarning, VMCodeExecutor


@pytest.fixture
def mock_client():
    """Create a mock MCPClient for testing."""
    client = MagicMock(spec=MCPClient)
    client.sessions = {}
    client.code_mode = True
    return client


@pytest.fixture
def code_executor(mock_client):
    """Create a CodeExecutor instance for testing."""
    return CodeExecutor(mock_client)


class TestCodeExecutorBasics:
    """Test basic code execution functionality."""

    @pytest.mark.asyncio
    async def test_execute_simple_code(self, code_executor):
        """Test executing simple Python code."""
        code = "result = 1 + 1\nreturn result"

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == 2
        assert isinstance(result["execution_time"], float)
        assert result["execution_time"] > 0

    @pytest.mark.asyncio
    async def test_execute_with_print(self, code_executor):
        """Test that print statements are captured."""
        code = """
print("Hello")
print("World")
return "done"
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == "done"
        assert "Hello" in result["logs"]
        assert "World" in result["logs"]

    @pytest.mark.asyncio
    async def test_execute_with_variables(self, code_executor):
        """Test executing code with variables."""
        code = """
x = 10
y = 20
z = x + y
return z
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == 30

    @pytest.mark.asyncio
    async def test_execute_with_loops(self, code_executor):
        """Test executing code with loops."""
        code = """
total = 0
for i in range(5):
    total += i
return total
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == 10  # 0 + 1 + 2 + 3 + 4

    @pytest.mark.asyncio
    async def test_execute_with_list_comprehension(self, code_executor):
        """Test executing code with list comprehensions."""
        code = """
numbers = [1, 2, 3, 4, 5]
squares = [n**2 for n in numbers]
return squares
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == [1, 4, 9, 16, 25]

    @pytest.mark.asyncio
    async def test_execute_with_dict(self, code_executor):
        """Test executing code that returns a dictionary."""
        code = """
data = {
    'name': 'Test',
    'value': 42,
    'items': [1, 2, 3]
}
return data
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"]["name"] == "Test"
        assert result["result"]["value"] == 42
        assert result["result"]["items"] == [1, 2, 3]


class TestCodeExecutorSecurity:
    """Defense-in-depth checks for the in-process executor (issue #1718).

    The in-process executor is NOT a security boundary (see VMCodeExecutor). These
    tests verify the AST defense-in-depth layer: known namespace-escape vectors are
    rejected before execution, and the introspection builtins that make escapes
    trivial are withheld. They are risk-reduction guarantees, not a sandbox.
    """

    @pytest.mark.asyncio
    async def test_no_import(self, code_executor):
        """Import statements are rejected."""
        result = await code_executor.execute("import os", timeout=5.0)

        assert result["error"] is not None
        assert "import" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_no_file_access(self, code_executor):
        """`open` is not available."""
        result = await code_executor.execute("open('/etc/passwd', 'r')", timeout=5.0)

        assert result["error"] is not None

    @pytest.mark.asyncio
    async def test_no_eval(self, code_executor):
        """`eval` is not available."""
        result = await code_executor.execute("eval('1 + 1')", timeout=5.0)

        assert result["error"] is not None

    # --- #1718 sandbox-escape regression tests -------------------------------

    @pytest.mark.asyncio
    async def test_subclasses_escape_blocked(self, code_executor):
        """The classic ().__class__.__base__.__subclasses__() walk is blocked."""
        code = "return ().__class__.__base__.__subclasses__()"

        result = await code_executor.execute(code, timeout=5.0)

        assert result["result"] is None
        assert result["error"] is not None
        assert "__subclasses__" in result["error"] or "dunder" in result["error"]

    @pytest.mark.asyncio
    async def test_builtins_reconstruction_blocked(self, code_executor):
        """Reconstructing __import__ via a function's __globals__ is blocked."""
        code = (
            "for c in ().__class__.__base__.__subclasses__():\n"
            "    g = c.__init__.__globals__\n"
            "    if '__builtins__' in g:\n"
            "        return g['__builtins__']['__import__']('os')\n"
            "return None"
        )

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None

    @pytest.mark.asyncio
    async def test_getattr_string_escape_blocked(self, code_executor):
        """getattr-with-a-dunder-string escape is blocked (getattr withheld + dunder string)."""
        code = "return getattr((), '__class__')"

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None

    @pytest.mark.asyncio
    async def test_format_string_escape_blocked(self, code_executor):
        """str.format attribute traversal is blocked by the dunder-string rule."""
        code = "return '{0.__class__}'.format(())"

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "snippet",
        [
            'return asyncio.base_events.os.popen("whoami").read()',
            'return asyncio.base_subprocess.os.popen("hostname").read()',
            "return asyncio.base_events.subprocess",
            "return asyncio.events.os.environ",
            'return asyncio.events.sys.modules["os"]',
            "return asyncio.get_event_loop",
        ],
    )
    async def test_asyncio_facade_blocks_module_escape(self, code_executor, snippet):
        """The injected ``asyncio`` is a curated facade: the real module's
        transitive os/sys/subprocess attribute chains are not reachable."""
        result = await code_executor.execute(snippet, timeout=5.0)

        assert result["result"] is None
        assert result["error"] is not None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "snippet",
        [
            "async def f():\n    return 1\nc = f()\nreturn c.cr_frame",  # coroutine frame
            "g = (i for i in [1])\nreturn g.gi_frame",  # generator frame
            "g = (i for i in [1])\nreturn g.gi_code",  # generator code object
            "return [].append.f_back",  # any .f_back access is rejected
            "x = 1\nreturn x.f_globals",  # any .f_globals access is rejected
        ],
    )
    async def test_frame_introspection_attrs_blocked(self, code_executor, snippet):
        """Non-dunder frame/code/coroutine/generator/traceback attributes are
        rejected (they re-expose real globals/builtins)."""
        result = await code_executor.execute(snippet, timeout=5.0)

        assert result["error"] is not None

    @pytest.mark.asyncio
    async def test_asyncio_facade_still_supports_await(self, code_executor):
        """The facade must keep documented coroutine helpers working."""
        code = (
            "async def one(n):\n"
            "    await asyncio.sleep(0.01)\n"
            "    return n\n"
            "results = await asyncio.gather(one(1), one(2))\n"
            "return sum(results)"
        )

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == 3

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "snippet",
        [
            # `case Cls(__dunder__=x)` does getattr(subject, "__dunder__") internally.
            "match []:\n    case list(__class__=c):\n        pass\nreturn c",
            "match {}:\n    case dict(__class__=c):\n        return c",
            "match ():\n    case tuple(__doc__=d):\n        return d",
            # introspection attrs are blocked in patterns too
            "async def f():\n    return 1\nc = f()\nmatch c:\n    case object(cr_frame=fr):\n        return fr",
            "g = (i for i in [1])\nmatch g:\n    case object(gi_frame=fr):\n        return fr",
        ],
    )
    async def test_match_pattern_attr_escape_blocked(self, code_executor, snippet):
        """Class match patterns cannot be used as a getattr bypass for dunder /
        introspection attributes (#1718 follow-up)."""
        result = await code_executor.execute(snippet, timeout=5.0)

        assert result["result"] is None
        assert result["error"] is not None

    @pytest.mark.asyncio
    async def test_benign_match_still_works(self, code_executor):
        """Ordinary structural pattern matching (no dunder attrs) is unaffected."""
        code = (
            "point = (3, 4)\n"
            "match point:\n"
            "    case (x, y):\n"
            "        return x + y\n"
            "    case _:\n"
            "        return 0"
        )

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == 7

    @pytest.mark.asyncio
    async def test_denied_names_can_be_shadowed_as_locals(self, code_executor):
        """A denied builtin name used as an ordinary local (assigned then read) is
        allowed; only loading the real builtin is rejected. Prevents false positives
        on common data like `type = row["type"]`."""
        code = (
            'row = {"type": "user", "input": "hi"}\n'
            'type = row["type"]\n'
            'input = row["input"]\n'
            "object = {\"k\": 1}\n"
            "return [type, input, object[\"k\"]]"
        )

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == ["user", "hi", 1]

    @pytest.mark.asyncio
    async def test_warn_does_not_break_under_warnings_as_errors(self, code_executor):
        """The one-time insecure-execution warning must never raise out of
        execute(), even under `warnings.simplefilter("error")`."""
        import warnings as _warnings

        VMCodeExecutor._warned = False  # force the warning to fire this run
        try:
            with _warnings.catch_warnings():
                _warnings.simplefilter("error")
                result = await code_executor.execute("return 1 + 1", timeout=5.0)
        finally:
            VMCodeExecutor._warned = True

        assert result["error"] is None
        assert result["result"] == 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "snippet",
        [
            "return asyncio.gather().get_loop()",  # Future.get_loop() -> running loop
            "return asyncio.gather(asyncio.sleep(0))._loop",
            "return asyncio.Lock()._get_loop()",
            "return asyncio.Lock()._loop",
            "return asyncio.Queue()._loop",
            # full loop-leak RCE: duck-typed protocol (no class) + loop.subprocess_shell
            (
                "p = Exception()\n"
                "p.connection_made = lambda t: None\n"
                "p.process_exited = lambda: None\n"
                "lo = asyncio.gather(asyncio.sleep(0)).get_loop()\n"
                "return await lo.subprocess_shell(lambda: p, 'echo hi')"
            ),
        ],
    )
    async def test_event_loop_not_reachable_via_facade(self, code_executor, snippet):
        """The asyncio facade returns real Futures/primitives; the running loop
        (which exposes subprocess_shell -> RCE) must not be reachable through
        get_loop/_get_loop/_loop."""
        result = await code_executor.execute(snippet, timeout=5.0)

        assert result["result"] is None
        assert result["error"] is not None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "snippet",
        [
            "x = (1).__class__",  # dunder attribute access
            "return type(1)",  # `type` withheld + denied
            "return getattr",  # `getattr` withheld + denied
            "return hasattr((), 'x')",  # `hasattr` withheld + denied
            "return object()",  # `object` denied
            "return '__subclasses__'",  # dunder string literal
            "y = __builtins__",  # dunder name
        ],
    )
    async def test_escape_primitives_blocked(self, code_executor, snippet):
        """Each known escape primitive is rejected."""
        result = await code_executor.execute(snippet, timeout=5.0)

        assert result["error"] is not None, f"expected {snippet!r} to be blocked"

    @pytest.mark.asyncio
    async def test_dynamic_dunder_string_cannot_escalate_to_rce(self, code_executor):
        """A dunder name built at runtime evades the literal scan, and ``str.format``
        can walk it to real module/builtins state, but only as a *repr string* --
        never a live/callable handle -- so it is info-disclosure, not RCE.

        Here we assert the security-relevant boundary: the format traversal yields a
        plain ``str`` and cannot be invoked or used as a live object.
        """
        code = (
            "g = '__glob' + 'als__'\n"
            "s = '{0.' + g + '}'\n"
            "leaked = s.format(search_tools)\n"
            "return isinstance(leaked, str)"
        )

        result = await code_executor.execute(code, timeout=5.0)

        # The traversal "succeeds" (info-disclosure residual: it reaches __globals__)
        # but only ever produces a string; there is no path to a callable, hence no RCE.
        assert result["error"] is None
        assert result["result"] is True

    @pytest.mark.asyncio
    async def test_legit_code_still_runs(self, code_executor):
        """Hardening must not break ordinary data-processing code."""
        code = (
            "data = [{'n': i, 'sq': i * i} for i in range(5)]\n"
            "total = sum(d['sq'] for d in data)\n"
            "names = sorted(['b', 'a', 'c'])\n"
            "return {'total': total, 'names': names, 'count': len(data)}"
        )

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == {"total": 30, "names": ["a", "b", "c"], "count": 5}

    @pytest.mark.asyncio
    async def test_safe_builtins_available(self, code_executor):
        """Test that safe builtins are available."""
        code = """
# Test safe builtins
result = {
    'len': len([1, 2, 3]),
    'sum': sum([1, 2, 3]),
    'max': max([1, 2, 3]),
    'min': min([1, 2, 3]),
    'sorted': sorted([3, 1, 2]),
    'str': str(42),
    'int': int('42'),
    'float': float('3.14'),
}
return result
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"]["len"] == 3
        assert result["result"]["sum"] == 6
        assert result["result"]["max"] == 3
        assert result["result"]["min"] == 1
        assert result["result"]["sorted"] == [1, 2, 3]
        assert result["result"]["str"] == "42"
        assert result["result"]["int"] == 42
        assert result["result"]["float"] == 3.14


class TestCodeExecutorTimeout:
    """Test timeout functionality."""

    @pytest.mark.asyncio
    async def test_timeout_enforcement(self, code_executor):
        """Test that timeout is enforced."""
        code = """
await asyncio.sleep(10)  # Sleep longer than timeout
return "should not reach here"
"""

        result = await code_executor.execute(code, timeout=0.5)

        assert result["error"] is not None
        assert "timeout" in result["error"].lower()
        assert result["result"] is None


class TestCodeExecutorWithTools:
    """Test code execution with mock MCP tools."""

    @pytest.mark.asyncio
    async def test_search_tools_function(self, mock_client, code_executor):
        """Test the search_tools function in execution namespace."""
        # Mock a session with tools
        mock_session = AsyncMock()
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "A test tool"
        mock_tool.inputSchema = {}

        mock_session.list_tools = AsyncMock(return_value=[mock_tool])
        mock_client.sessions = {"test_server": mock_session}

        code = """
result = await search_tools()
tools = result['results']
return {"count": len(tools), "names": [t['name'] for t in tools], "total": result['meta']['total_tools']}
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"]["count"] == 1
        assert result["result"]["names"] == ["test_tool"]

    @pytest.mark.asyncio
    async def test_search_tools_with_query(self, mock_client, code_executor):
        """Test search_tools with a query filter."""
        # Mock session with multiple tools
        mock_session = AsyncMock()

        tool1 = Mock()
        tool1.name = "github_get_pr"
        tool1.description = "Get a GitHub pull request"
        tool1.inputSchema = {}

        tool2 = Mock()
        tool2.name = "slack_post"
        tool2.description = "Post a message to Slack"
        tool2.inputSchema = {}

        mock_session.list_tools = AsyncMock(return_value=[tool1, tool2])
        mock_client.sessions = {"test": mock_session}

        code = """
all_result = await search_tools()
github_result = await search_tools("github")
slack_result = await search_tools("slack")

all_tools = all_result['results']
github_tools = github_result['results']
slack_tools = slack_result['results']

return {
    "total": len(all_tools),
    "github": len(github_tools),
    "slack": len(slack_tools)
}
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"]["total"] == 2
        assert result["result"]["github"] == 1
        assert result["result"]["slack"] == 1

    @pytest.mark.asyncio
    async def test_tool_namespaces_available(self, mock_client, code_executor):
        """Test that __tool_namespaces is available."""
        mock_session = AsyncMock()
        # Return at least one dummy tool so the namespace is created
        mock_tool = Mock()
        mock_tool.name = "dummy_tool"
        mock_session.list_tools = AsyncMock(return_value=[mock_tool])

        # Mock sessions dictionary directly on the client mock
        mock_client.sessions = {"server1": mock_session, "server2": mock_session}
        # Mock get_server_names to return empty list to avoid connection attempt
        mock_client.get_server_names = Mock(return_value=[])

        code = """
return {"namespaces": __tool_namespaces}
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert set(result["result"]["namespaces"]) == {"server1", "server2"}

    @pytest.mark.asyncio
    async def test_tool_wrapper_creation(self, mock_client, code_executor):
        """Test that tool wrappers are created and callable."""
        # Create a mock session with a tool
        mock_session = AsyncMock()
        mock_tool = Mock()
        mock_tool.name = "test_operation"
        mock_tool.description = "Test operation"
        mock_tool.inputSchema = {}

        mock_session.list_tools = AsyncMock(return_value=[mock_tool])

        # Mock the call_tool response
        mock_result = Mock()
        mock_result.content = [Mock(text="operation result")]
        mock_session.call_tool = AsyncMock(return_value=mock_result)

        mock_client.sessions = {"testserver": mock_session}
        mock_client.get_session = Mock(return_value=mock_session)

        code = """
# Call the mocked tool
result = await testserver.test_operation(param1="value1")
return {"result": result}
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"]["result"] == "operation result"
        mock_session.call_tool.assert_called_once_with("test_operation", {"param1": "value1"})


class TestCodeExecutorErrorHandling:
    """Test error handling in code execution."""

    @pytest.mark.asyncio
    async def test_syntax_error(self, code_executor):
        """Test handling of syntax errors."""
        code = "if True\nreturn 1"  # Missing colon

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None
        # The actual error message might vary by Python version
        assert (
            "syntax" in result["error"].lower()
            or "invalid" in result["error"].lower()
            or "expected" in result["error"].lower()
        )

    @pytest.mark.asyncio
    async def test_runtime_error(self, code_executor):
        """Test handling of runtime errors."""
        code = """
x = 1 / 0  # Division by zero
return x
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None
        assert "division" in result["error"].lower() or "zero" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_name_error(self, code_executor):
        """Test handling of name errors."""
        code = "return undefined_variable"

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None
        assert "name" in result["error"].lower() or "undefined" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_type_error(self, code_executor):
        """Test handling of type errors."""
        code = "return 'string' + 123"

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is not None


class TestCodeExecutorAsyncSupport:
    """Test async/await support in code execution."""

    @pytest.mark.asyncio
    async def test_async_code(self, code_executor):
        """Test executing async code with await."""
        code = """
async def my_async_function():
    await asyncio.sleep(0.1)
    return "async result"

result = await my_async_function()
return result
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == "async result"

    @pytest.mark.asyncio
    async def test_multiple_awaits(self, code_executor):
        """Test multiple await statements."""
        code = """
async def func1():
    await asyncio.sleep(0.05)
    return 1

async def func2():
    await asyncio.sleep(0.05)
    return 2

a = await func1()
b = await func2()
return a + b
"""

        result = await code_executor.execute(code, timeout=5.0)

        assert result["error"] is None
        assert result["result"] == 3


class TestCodeExecutorSecurityWarning:
    """The in-process executor warns that it is not a security boundary."""

    @pytest.mark.asyncio
    async def test_insecure_warning_emitted(self, mock_client):
        """An InsecureCodeExecutionWarning is emitted when running in-process."""
        VMCodeExecutor._warned = False
        executor = VMCodeExecutor(mock_client)

        with pytest.warns(InsecureCodeExecutionWarning):
            await executor.execute("return 1", timeout=5.0)

    @pytest.mark.asyncio
    async def test_insecure_warning_emitted_once(self, mock_client):
        """The warning is emitted at most once per process, not per call."""
        VMCodeExecutor._warned = False
        executor = VMCodeExecutor(mock_client)

        import warnings

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            await executor.execute("return 1", timeout=5.0)
            await executor.execute("return 2", timeout=5.0)

        insecure = [w for w in caught if issubclass(w.category, InsecureCodeExecutionWarning)]
        assert len(insecure) == 1
