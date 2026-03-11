"""
Unit tests for fix_schema $ref resolution and LangChain adapter tool conversion.
"""

import unittest
from unittest.mock import AsyncMock, MagicMock

from jsonschema_pydantic import jsonschema_to_pydantic
from mcp.types import Resource
from mcp.types import Tool as MCPTool
from pydantic import AnyUrl

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter


class TestRefResolution(unittest.TestCase):
    """Tests for JSON Schema local $ref pointer resolution in fix_schema."""

    def setUp(self):
        """Set up test fixtures."""
        self.adapter = LangChainAdapter()

    def test_resolves_property_ref(self):
        """A $ref to another property is inlined and the $ref key is removed."""
        schema = {
            "type": "object",
            "properties": {
                "position": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "z": {"type": "number"},
                    },
                },
                "rotation": {"$ref": "#/properties/position"},
            },
        }
        fixed = self.adapter.fix_schema(schema)

        rotation = fixed["properties"]["rotation"]
        self.assertEqual(rotation["type"], "object")
        self.assertIn("x", rotation["properties"])
        self.assertNotIn("$ref", rotation)

    def test_defs_refs_left_intact(self):
        """$ref targeting $defs is left intact for jsonschema_to_pydantic to handle."""
        schema = {
            "type": "object",
            "properties": {
                "rotation": {"$ref": "#/$defs/Vector3"},
            },
            "$defs": {
                "Vector3": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "z": {"type": "number"},
                    },
                }
            },
        }
        fixed = self.adapter.fix_schema(schema)
        self.assertEqual(fixed["properties"]["rotation"]["$ref"], "#/$defs/Vector3")

    def test_definitions_refs_left_intact(self):
        """$ref targeting definitions (draft-07 style) is left intact for jsonschema_to_pydantic to handle."""
        schema = {
            "type": "object",
            "properties": {
                "item": {"$ref": "#/definitions/MyType"},
            },
            "definitions": {
                "MyType": {"type": "string"},
            },
        }
        fixed = self.adapter.fix_schema(schema)
        self.assertEqual(fixed["properties"]["item"]["$ref"], "#/definitions/MyType")

    def test_circular_ref_does_not_recurse_infinitely(self):
        """A self-referencing $ref does not cause infinite recursion and is left intact."""
        schema = {
            "type": "object",
            "properties": {
                "self_ref": {"$ref": "#/properties/self_ref"},
            },
        }
        fixed = self.adapter.fix_schema(schema)
        self.assertIsInstance(fixed, dict)
        # The circular ref cannot be resolved, so it must be left as-is
        self.assertIn("$ref", fixed["properties"]["self_ref"])

    def test_unresolvable_ref_left_intact(self):
        """A $ref to a non-existent path is left as-is without raising."""
        schema = {
            "type": "object",
            "properties": {
                "field": {"$ref": "#/nonexistent/path"},
            },
        }
        fixed = self.adapter.fix_schema(schema)
        self.assertEqual(fixed["properties"]["field"]["$ref"], "#/nonexistent/path")

    def test_sibling_keys_combined_via_allof_on_resolution(self):
        """Sibling keys alongside $ref are combined via allOf to avoid overwriting resolved constraints."""
        schema = {
            "type": "object",
            "properties": {
                "position": {"type": "object", "properties": {"x": {"type": "number"}}},
                "rotation": {"$ref": "#/properties/position", "description": "The rotation"},
            },
        }
        fixed = self.adapter.fix_schema(schema)
        rotation = fixed["properties"]["rotation"]
        self.assertIn("allOf", rotation)
        sub_schemas = rotation["allOf"]
        self.assertTrue(any(s.get("type") == "object" for s in sub_schemas))
        self.assertTrue(any(s.get("description") == "The rotation" for s in sub_schemas))

    def test_sibling_keys_allof_produces_valid_pydantic_model(self):
        """A $ref with sibling keys (allOf merge) is accepted by jsonschema_to_pydantic.

        Regression test: verifies the allOf structure produced for sibling-key $refs
        does not prevent Pydantic model generation.
        """
        schema = {
            "type": "object",
            "properties": {
                "position": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "z": {"type": "number"},
                    },
                },
                "rotation": {"$ref": "#/properties/position", "description": "The rotation"},
            },
            "required": ["position", "rotation"],
        }
        fixed = self.adapter.fix_schema(schema)
        model = jsonschema_to_pydantic(fixed)
        self.assertIsNotNone(model)
        self.assertIn("position", model.model_fields)
        self.assertIn("rotation", model.model_fields)

    def test_property_ref_produces_valid_pydantic_model(self):
        """A schema with inlined property $refs is accepted by jsonschema_to_pydantic.

        Regression test for https://github.com/mcp-use/mcp-use/issues/964.
        """
        schema = {
            "type": "object",
            "properties": {
                "position": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "z": {"type": "number"},
                    },
                },
                "rotation": {"$ref": "#/properties/position"},
            },
            "required": ["position", "rotation"],
        }
        fixed = self.adapter.fix_schema(schema)
        model = jsonschema_to_pydantic(fixed)
        self.assertIsNotNone(model)
        self.assertIn("position", model.model_fields)
        self.assertIn("rotation", model.model_fields)

    def test_resolves_array_index_ref(self):
        """A $ref with a numeric JSON Pointer segment traverses list nodes correctly."""
        schema = {
            "type": "object",
            "allOf": [
                {"properties": {"x": {"type": "number"}}},
            ],
            "properties": {
                "alias": {"$ref": "#/allOf/0"},
            },
        }
        fixed = self.adapter.fix_schema(schema)
        alias = fixed["properties"]["alias"]
        self.assertNotIn("$ref", alias)
        self.assertIn("x", alias["properties"])

    def test_json_pointer_rfc6901_escaping(self):
        """JSON Pointer escape sequences (~0, ~1) are decoded per RFC 6901."""
        schema = {
            "type": "object",
            "properties": {
                "my/prop": {"type": "string"},
                "alias": {"$ref": "#/properties/my~1prop"},
            },
        }
        fixed = self.adapter.fix_schema(schema)
        self.assertEqual(fixed["properties"]["alias"]["type"], "string")
        self.assertNotIn("$ref", fixed["properties"]["alias"])


class TestNoneFilteringInToolCall(unittest.IsolatedAsyncioTestCase):
    """Tests that None/null optional values are stripped before calling the MCP server."""

    async def test_none_values_stripped_from_tool_call(self):
        """Optional fields with None values should not be sent to the MCP server.

        Regression test: MCP servers using Zod .optional() accept absent fields
        but reject explicit null, so we must strip None values before the call.
        """
        adapter = LangChainAdapter()

        # Schema mimicking add_asset_to_scene: assetPath required, others optional
        schema = {
            "type": "object",
            "properties": {
                "assetPath": {"type": "string"},
                "guid": {"type": "string"},
                "parentPath": {"type": "string"},
                "parentId": {"type": "number"},
            },
            "required": ["assetPath"],
        }

        mock_connector = MagicMock()
        mock_result = MagicMock()
        mock_result.content = [MagicMock(text="ok")]
        mock_connector.call_tool = AsyncMock(return_value=mock_result)

        mcp_tool = MCPTool(name="add_asset_to_scene", description="test", inputSchema=schema)
        lc_tool = adapter._convert_tool(mcp_tool, mock_connector)

        # Simulate LangChain passing None for optional fields
        await lc_tool._arun(assetPath="Prefabs/Cube.prefab", guid=None, parentPath=None, parentId=None)

        # Verify only non-None values were forwarded
        mock_connector.call_tool.assert_called_once()
        actual_args = mock_connector.call_tool.call_args[0][1]
        self.assertNotIn("guid", actual_args)
        self.assertNotIn("parentPath", actual_args)
        self.assertNotIn("parentId", actual_args)
        self.assertEqual(actual_args["assetPath"], "Prefabs/Cube.prefab")

    async def test_required_nullable_none_is_preserved(self):
        """Required nullable fields should be forwarded as explicit null."""
        adapter = LangChainAdapter()

        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "parentId": {"type": ["number", "null"]},
            },
            "required": ["name", "parentId"],
        }

        mock_connector = MagicMock()
        mock_result = MagicMock()
        mock_result.content = [MagicMock(text="ok")]
        mock_connector.call_tool = AsyncMock(return_value=mock_result)

        mcp_tool = MCPTool(name="set_parent", description="test", inputSchema=schema)
        lc_tool = adapter._convert_tool(mcp_tool, mock_connector)

        await lc_tool._arun(name="Cube", parentId=None)

        mock_connector.call_tool.assert_called_once()
        actual_args = mock_connector.call_tool.call_args[0][1]
        self.assertIn("parentId", actual_args)
        self.assertIsNone(actual_args["parentId"])
        self.assertEqual(actual_args["name"], "Cube")

    async def test_optional_nullable_none_is_preserved(self):
        """Optional nullable fields should be forwarded as explicit null."""
        adapter = LangChainAdapter()

        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "label": {"type": "string"},
                "parentId": {"type": ["number", "null"]},
            },
            "required": ["name"],
        }

        mock_connector = MagicMock()
        mock_result = MagicMock()
        mock_result.content = [MagicMock(text="ok")]
        mock_connector.call_tool = AsyncMock(return_value=mock_result)

        mcp_tool = MCPTool(name="set_parent_optional", description="test", inputSchema=schema)
        lc_tool = adapter._convert_tool(mcp_tool, mock_connector)

        await lc_tool._arun(name="Cube", label=None, parentId=None)

        mock_connector.call_tool.assert_called_once()
        actual_args = mock_connector.call_tool.call_args[0][1]
        self.assertNotIn("label", actual_args)
        self.assertIn("parentId", actual_args)
        self.assertIsNone(actual_args["parentId"])
        self.assertEqual(actual_args["name"], "Cube")

    async def test_optional_nullable_none_via_defs_ref_is_preserved(self):
        """Optional nullable fields referenced via $defs should keep explicit null."""
        adapter = LangChainAdapter()

        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "parentId": {"$ref": "#/$defs/NullableId"},
                "label": {"type": "string"},
            },
            "required": ["name"],
            "$defs": {
                "NullableId": {
                    "anyOf": [{"type": "number"}, {"type": "null"}],
                }
            },
        }

        mock_connector = MagicMock()
        mock_result = MagicMock()
        mock_result.content = [MagicMock(text="ok")]
        mock_connector.call_tool = AsyncMock(return_value=mock_result)

        mcp_tool = MCPTool(name="set_parent_optional_defs", description="test", inputSchema=schema)
        lc_tool = adapter._convert_tool(mcp_tool, mock_connector)

        await lc_tool._arun(name="Cube", label=None, parentId=None)

        mock_connector.call_tool.assert_called_once()
        actual_args = mock_connector.call_tool.call_args[0][1]
        self.assertNotIn("label", actual_args)
        self.assertIn("parentId", actual_args)
        self.assertIsNone(actual_args["parentId"])
        self.assertEqual(actual_args["name"], "Cube")


class TestResourceToolSchema(unittest.IsolatedAsyncioTestCase):
    """Tests that LangChain resource tools use an empty args schema."""

    def test_resource_tool_has_empty_args_schema(self):
        """Resource tools should not expose a uri parameter.

        Regression test for #964: ReadResourceRequestParams leaked a uri field
        that caused AnyUrl validation errors when the LLM passed a plain string.
        """
        adapter = LangChainAdapter()
        mock_connector = MagicMock()

        resource = Resource(uri=AnyUrl("file:///test/path"), name="test_resource", description="A test resource")
        tool = adapter._convert_resource(resource, mock_connector)

        # The schema should have no required fields and no uri property
        schema = tool.args_schema.model_json_schema()
        self.assertEqual(schema.get("properties", {}), {})
        self.assertNotIn("uri", schema.get("properties", {}))

    async def test_resource_tool_invocable_without_uri(self):
        """Resource tool should be callable with no arguments.

        Regression test for #964: passing uri as a kwarg would fail AnyUrl validation.
        """
        adapter = LangChainAdapter()

        mock_connector = MagicMock()
        mock_content = MagicMock()
        mock_content.__str__ = lambda self: "resource content"
        mock_result = MagicMock()
        mock_result.contents = [mock_content]
        mock_connector.read_resource = AsyncMock(return_value=mock_result)

        resource = Resource(uri=AnyUrl("file:///test/path"), name="test_resource", description="A test resource")
        tool = adapter._convert_resource(resource, mock_connector)

        result = await tool._arun()
        mock_connector.read_resource.assert_called_once_with(AnyUrl("file:///test/path"))
        self.assertEqual(result, "resource content")


if __name__ == "__main__":
    unittest.main()
