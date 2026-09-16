"""Tests for resource tools exposed through the optional Google adapter."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from jsonschema import Draft202012Validator
from mcp.types import ReadResourceResult, Resource, TextResourceContents

from mcp_use.client.connectors.base import BaseConnector

types = pytest.importorskip("google.genai.types")


@pytest.fixture
def adapter():
    from mcp_use.agents.adapters.google import GoogleMCPAdapter

    return GoogleMCPAdapter()


@pytest.fixture
def resource_connector():
    resource = Resource(uri="notes://project", name="Project notes", description="Project notes")
    connector = MagicMock(spec=BaseConnector)
    connector.list_resources = AsyncMock(return_value=[resource])
    connector.read_resource = AsyncMock(
        return_value=ReadResourceResult(contents=[TextResourceContents(uri=resource.uri, text="Notes")])
    )
    return resource, connector


@pytest.mark.asyncio
async def test_resource_tool_parameters_describe_an_object(resource_connector, adapter):
    _, connector = resource_connector
    declarations = await adapter.load_resources_for_connector(connector)
    config = types.GenerateContentConfig(tools=[types.Tool(function_declarations=declarations)])
    payload = config.model_dump(by_alias=True, exclude_none=True)
    declaration = payload["tools"][0]["functionDeclarations"][0]
    validator = Draft202012Validator(declaration["parametersJsonSchema"])

    assert validator.is_valid({})
    for invalid_arguments in [None, [], "notes", 1]:
        assert not validator.is_valid(invalid_arguments)


@pytest.mark.asyncio
async def test_resource_tool_reads_the_original_uri_without_arguments(resource_connector, adapter):
    resource, connector = resource_connector
    declarations = await adapter.load_resources_for_connector(connector)

    result = await adapter.tool_executors[declarations[0].name]()

    connector.read_resource.assert_awaited_once_with(resource.uri)
    assert result == connector.read_resource.return_value


@pytest.mark.asyncio
async def test_disallowed_resource_is_not_registered(resource_connector, adapter):
    _, connector = resource_connector
    adapter.disallowed_tools.append("resource_Project_notes")

    assert await adapter.load_resources_for_connector(connector) == []
    assert adapter.tool_executors == {}
