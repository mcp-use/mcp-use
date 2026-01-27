"""
Test that LangChain adapter tools can be created without pickle/deepcopy errors.

This test verifies the fix for issue #734 where Pydantic's deepcopy of connector
objects containing asyncio primitives (Event, Task, Future) would fail.
"""

import asyncio
import copy
import unittest
from unittest.mock import AsyncMock, MagicMock

from mcp.types import Tool as MCPTool

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter


class TestLangChainAdapterPickle(unittest.TestCase):
    """Test that adapter tools don't cause pickle/deepcopy issues."""

    def test_convert_tool_no_deepcopy_of_connector(self):
        """Test that _convert_tool doesn't store connector as a Pydantic field.

        The old implementation stored connector as a class attribute on a
        dynamically created BaseTool subclass. Pydantic would then try to
        deepcopy the connector during field initialization, which would fail
        if the connector contained asyncio objects (Event, Task, Future).

        The new implementation uses StructuredTool.from_function() which
        captures the connector in a closure instead.
        """
        adapter = LangChainAdapter()

        # Create a mock connector that simulates having asyncio objects
        # We use MagicMock for the task since we can't create a real one without an event loop
        # The key point is that the tool creation should work regardless of what's in the connector
        mock_connector = MagicMock()
        mock_connector._connection_manager = MagicMock()
        # Simulate asyncio.Event objects (these have __reduce__ methods that can fail)
        mock_connector._connection_manager._ready_event = MagicMock(spec=asyncio.Event)
        mock_connector._connection_manager._done_event = MagicMock(spec=asyncio.Event)
        mock_connector._connection_manager._stop_event = MagicMock(spec=asyncio.Event)
        # Simulate an asyncio.Task (which contains Future objects that can't be pickled)
        mock_connector._connection_manager._task = MagicMock(spec=asyncio.Task)

        # Create a mock MCP tool
        mcp_tool = MCPTool(
            name="test_tool",
            description="A test tool",
            inputSchema={"type": "object", "properties": {"arg1": {"type": "string"}}},
        )

        # This should NOT raise TypeError about pickling asyncio.Future
        # The old implementation would fail here during Pydantic field creation
        tool = adapter._convert_tool(mcp_tool, mock_connector)

        # Verify tool was created successfully
        self.assertIsNotNone(tool)
        self.assertEqual(tool.name, "test_tool")
        self.assertEqual(tool.description, "A test tool")

    def test_tool_does_not_have_connector_attribute(self):
        """Test that the created tool doesn't expose connector as an attribute.

        The connector should be captured in a closure, not stored as a model field.
        This prevents serialization/deepcopy issues.
        """
        adapter = LangChainAdapter()

        mock_connector = MagicMock()
        mcp_tool = MCPTool(
            name="test_tool",
            description="A test tool",
            inputSchema={"type": "object", "properties": {}},
        )

        tool = adapter._convert_tool(mcp_tool, mock_connector)

        # The tool should NOT have a tool_connector attribute (old implementation)
        self.assertFalse(hasattr(tool, "tool_connector"))

    def test_multiple_tools_with_same_connector(self):
        """Test creating multiple tools from the same connector."""
        adapter = LangChainAdapter()

        mock_connector = MagicMock()

        tools = []
        for i in range(5):
            mcp_tool = MCPTool(
                name=f"tool_{i}",
                description=f"Tool number {i}",
                inputSchema={"type": "object", "properties": {}},
            )
            tool = adapter._convert_tool(mcp_tool, mock_connector)
            tools.append(tool)

        # All tools should be created successfully
        self.assertEqual(len(tools), 5)
        for i, tool in enumerate(tools):
            self.assertEqual(tool.name, f"tool_{i}")

    def test_tool_with_complex_schema(self):
        """Test creating a tool with a complex input schema."""
        adapter = LangChainAdapter()

        mock_connector = MagicMock()
        mcp_tool = MCPTool(
            name="complex_tool",
            description="A tool with complex schema",
            inputSchema={
                "type": "object",
                "properties": {
                    "string_arg": {"type": "string", "description": "A string argument"},
                    "number_arg": {"type": "number", "description": "A number argument"},
                    "bool_arg": {"type": "boolean", "description": "A boolean argument"},
                    "array_arg": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "An array argument",
                    },
                },
                "required": ["string_arg"],
            },
        )

        tool = adapter._convert_tool(mcp_tool, mock_connector)

        self.assertIsNotNone(tool)
        self.assertEqual(tool.name, "complex_tool")


class TestLangChainAdapterToolExecution(unittest.IsolatedAsyncioTestCase):
    """Test that adapter tools execute correctly via closure."""

    async def test_tool_execution_uses_closure(self):
        """Test that tool execution correctly uses the connector from closure."""
        adapter = LangChainAdapter()

        # Create a mock connector that returns a result
        mock_connector = MagicMock()
        mock_result = MagicMock()
        mock_result.content = "Tool execution result"
        mock_connector.call_tool = AsyncMock(return_value=mock_result)

        mcp_tool = MCPTool(
            name="executable_tool",
            description="A tool that can be executed",
            inputSchema={
                "type": "object",
                "properties": {"input": {"type": "string"}},
            },
        )

        tool = adapter._convert_tool(mcp_tool, mock_connector)

        # Execute the tool
        result = await tool.ainvoke({"input": "test"})

        # Verify the connector was called correctly
        mock_connector.call_tool.assert_called_once_with("executable_tool", {"input": "test"})
        self.assertIn("Tool execution result", result)

    async def test_different_tools_use_different_connectors(self):
        """Test that each tool uses its own connector from closure."""
        adapter = LangChainAdapter()

        # Create two different mock connectors
        mock_connector_1 = MagicMock()
        mock_result_1 = MagicMock()
        mock_result_1.content = "Result from connector 1"
        mock_connector_1.call_tool = AsyncMock(return_value=mock_result_1)

        mock_connector_2 = MagicMock()
        mock_result_2 = MagicMock()
        mock_result_2.content = "Result from connector 2"
        mock_connector_2.call_tool = AsyncMock(return_value=mock_result_2)

        mcp_tool_1 = MCPTool(
            name="tool_1",
            description="Tool 1",
            inputSchema={"type": "object", "properties": {}},
        )
        mcp_tool_2 = MCPTool(
            name="tool_2",
            description="Tool 2",
            inputSchema={"type": "object", "properties": {}},
        )

        tool_1 = adapter._convert_tool(mcp_tool_1, mock_connector_1)
        tool_2 = adapter._convert_tool(mcp_tool_2, mock_connector_2)

        # Execute both tools
        result_1 = await tool_1.ainvoke({})
        result_2 = await tool_2.ainvoke({})

        # Verify each tool used its own connector
        mock_connector_1.call_tool.assert_called_once()
        mock_connector_2.call_tool.assert_called_once()
        self.assertIn("Result from connector 1", result_1)
        self.assertIn("Result from connector 2", result_2)


if __name__ == "__main__":
    unittest.main()
