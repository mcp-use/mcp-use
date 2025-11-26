"""
Unit tests for CodeExecutor.

Tests the code execution functionality for MCP code mode.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from mcp_use.client.client import MCPClient
from mcp_use.client.code_executor import CodeExecutor


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
    """Test security restrictions in code execution."""

    @pytest.mark.asyncio
    async def test_restricted_builtins(self, code_executor):
        """Test that dangerous builtins are not available."""
        code = "import os"

        result = await code_executor.execute(code, timeout=5.0)

        # Should fail because import is restricted
        assert result["error"] is not None
        assert "import" in result["error"].lower() or "name" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_no_file_access(self, code_executor):
        """Test that file operations are restricted."""
        code = "open('/etc/passwd', 'r')"

        result = await code_executor.execute(code, timeout=5.0)

        # Should fail because open is not in safe builtins
        assert result["error"] is not None

    @pytest.mark.asyncio
    async def test_no_eval(self, code_executor):
        """Test that eval is not available."""
        code = "eval('1 + 1')"

        result = await code_executor.execute(code, timeout=5.0)

        # Should fail because eval is restricted
        assert result["error"] is not None

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
