import unittest
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp.types import JSONRPCNotification, Tool, ToolListChangedNotification

from mcp_use.connectors.base import BaseConnector


class DummyConnector(BaseConnector):
    async def connect(self):
        pass


@patch("mcp_use.connectors.base.logger")
class TestBaseConnectorToolDiscovery(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.connector = DummyConnector()
        self.connector.client = MagicMock()  # Simulate connected state

    async def test_discovery_on_tool_list_changed_notification(self, mock_logger):
        """
        This test verifies that when the connector receives a ToolListChangedNotification
        (with method="notifications/tools/list_changed"), it refreshes its tool list
        by calling list_tools and updates its _tools cache accordingly. The test first
        sets an initial tool list, then simulates a change in the available tools,
        sends the notification, and checks that the connector's _tools is updated.
        """
        # Initial tools
        mocked_tools1 = [Tool(name="tool1", description="desc1", inputSchema={})]
        self.connector.list_tools = AsyncMock(return_value=mocked_tools1)

        # Patch initialize to set up the initial tools
        with patch.object(self.connector, "initialize", AsyncMock()):
            await self.connector.initialize()
            self.connector._tools = mocked_tools1  # Simulate initialize setting tools
        self.assertEqual(self.connector._tools, mocked_tools1)

        # Change tools to include a new tool
        mocked_tools2 = [
            Tool(name="tool1", description="desc1", inputSchema={}),
            Tool(name="tool2", description="desc2", inputSchema={}),
        ]
        self.connector.list_tools = AsyncMock(return_value=mocked_tools2)

        # Send notification to trigger discovery (notifications/tools/list_changed)
        notification = ToolListChangedNotification(method="notifications/tools/list_changed")
        await self.connector._handle_client_message(notification)

        # Assert _tools is updated and contains both tools
        self.assertEqual(self.connector._tools, mocked_tools2)
        self.assertEqual(len(self.connector._tools), 2)
        self.assertIn(mocked_tools2[0], self.connector._tools)
        self.assertIn(mocked_tools2[1], self.connector._tools)
