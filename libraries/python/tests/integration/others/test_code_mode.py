"""
Integration tests for code mode functionality.

These tests verify the end-to-end functionality of code mode with MCPClient.
"""

import pytest

from mcp_use.client.client import MCPClient


class TestCodeModeIntegration:
    """Integration tests for code mode with MCPClient."""

    def test_client_initialization_with_code_mode(self):
        """Test that MCPClient can be initialized with code_mode=True."""
        client = MCPClient(code_mode=True)

        assert client.code_mode is True
        assert client._code_executor is None  # Lazy initialization

    def test_client_initialization_without_code_mode(self):
        """Test that MCPClient defaults to code_mode=False."""
        client = MCPClient()

        assert client.code_mode is False

    @pytest.mark.asyncio
    async def test_execute_code_requires_code_mode(self):
        """Test that execute_code raises error when code_mode is False."""
        client = MCPClient(code_mode=False)

        with pytest.raises(RuntimeError, match="Code execution mode is not enabled"):
            await client.execute_code("return 1")

    @pytest.mark.asyncio
    async def test_execute_code_with_code_mode_enabled(self):
        """Test that execute_code works when code_mode is True."""
        client = MCPClient(code_mode=True)

        result = await client.execute_code("return 42")

        assert result["error"] is None
        assert result["result"] == 42
        assert "execution_time" in result
        assert "logs" in result

    @pytest.mark.asyncio
    async def test_search_tools_empty_sessions(self):
        """Test search_tools with no active sessions."""
        client = MCPClient(code_mode=True)

        tools = await client.search_tools("", detail_level="names")

        assert tools == [
            {
                "name": "execute_code",
                "server": "code_mode",
            },
            {
                "name": "search_tools",
                "server": "code_mode",
            },
        ]

    def test_from_dict_with_code_mode(self):
        """Test creating client from dict with code_mode."""
        config = {"mcpServers": {}}

        client = MCPClient.from_dict(config, code_mode=True)

        assert client.code_mode is True

    def test_from_config_file_with_code_mode(self, tmp_path):
        """Test creating client from config file with code_mode."""
        # Create a temporary config file
        config_file = tmp_path / "config.json"
        config_file.write_text('{"mcpServers": {}}')

        client = MCPClient.from_config_file(str(config_file), code_mode=True)

        assert client.code_mode is True


class TestCodeModeExecutionIntegration:
    """Integration tests for actual code execution."""

    @pytest.mark.asyncio
    async def test_execute_simple_calculation(self):
        """Test executing a simple calculation."""
        client = MCPClient(code_mode=True)

        result = await client.execute_code("""
a = 10
b = 20
return a + b
""")

        assert result["error"] is None
        assert result["result"] == 30

    @pytest.mark.asyncio
    async def test_execute_with_print_statements(self):
        """Test that print statements are captured in logs."""
        client = MCPClient(code_mode=True)

        result = await client.execute_code("""
print("Starting calculation")
x = 5 * 5
print(f"Result is {x}")
return x
""")

        assert result["error"] is None
        assert result["result"] == 25
        assert "Starting calculation" in result["logs"]
        assert "Result is 25" in result["logs"]

    @pytest.mark.asyncio
    async def test_execute_with_data_processing(self):
        """Test executing code that processes data."""
        client = MCPClient(code_mode=True)

        result = await client.execute_code("""
# Process a list of numbers
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
print(f"Processing {len(numbers)} numbers")

# Filter even numbers
evens = [n for n in numbers if n % 2 == 0]
print(f"Found {len(evens)} even numbers")

# Calculate statistics
total = sum(evens)
average = total / len(evens)

return {
    "evens": evens,
    "total": total,
    "average": average
}
""")

        assert result["error"] is None
        assert result["result"]["evens"] == [2, 4, 6, 8, 10]
        assert result["result"]["total"] == 30
        assert result["result"]["average"] == 6.0
        assert len(result["logs"]) >= 2

    @pytest.mark.asyncio
    async def test_execute_with_error(self):
        """Test error handling in code execution."""
        client = MCPClient(code_mode=True)

        result = await client.execute_code("""
x = 1 / 0  # This will raise an error
return x
""")

        assert result["error"] is not None
        assert "division" in result["error"].lower() or "zero" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_code_executor_lazy_initialization(self):
        """Test that CodeExecutor is lazily initialized."""
        client = MCPClient(code_mode=True)

        assert client._code_executor is None

        await client.execute_code("return 1")

        assert client._code_executor is not None

    @pytest.mark.asyncio
    async def test_multiple_executions_reuse_executor(self):
        """Test that multiple executions reuse the same executor."""
        client = MCPClient(code_mode=True)

        result1 = await client.execute_code("return 1")
        executor1 = client._code_executor

        result2 = await client.execute_code("return 2")
        executor2 = client._code_executor

        assert result1["result"] == 1
        assert result2["result"] == 2
        assert executor1 is executor2  # Same instance


class TestSearchToolsIntegration:
    """Integration tests for search_tools functionality."""

    @pytest.mark.asyncio
    async def test_search_tools_with_different_detail_levels(self):
        """Test search_tools with different detail levels."""
        client = MCPClient(code_mode=True)

        # Test with empty sessions (should return empty list)
        names = await client.search_tools("", detail_level="names")
        descriptions = await client.search_tools("", detail_level="descriptions")
        full = await client.search_tools("", detail_level="full")

        assert names == [
            {
                "name": "execute_code",
                "server": "code_mode",
            },
            {
                "name": "search_tools",
                "server": "code_mode",
            },
        ]
        assert len(descriptions) == 2
        assert all("name" in t and "server" in t and "description" in t for t in descriptions)
        assert descriptions[0]["name"] == "execute_code"
        assert descriptions[1]["name"] == "search_tools"

        assert len(full) == 2
        assert all("name" in t and "server" in t and "description" in t and "input_schema" in t for t in full)
        assert full[0]["name"] == "execute_code"
        assert full[1]["name"] == "search_tools"
