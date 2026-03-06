"""Verify that MCPServer produces MCP-compliant tool JSON Schemas.

Registers a tool with every meaningful combination of (type x required/optional/nullable)
and asserts the exact JSON Schema output. Catches regressions in:

- ``anyOf``/null simplification for nullable parameters
- Type mapping (Python type → JSON Schema type)
- Description propagation from Field() to the schema
- Required vs optional classification
- Default value preservation
"""

from __future__ import annotations

from typing import Annotated

import pytest
from pydantic import Field

from mcp_use.server import MCPServer

# ---------------------------------------------------------------------------
# Server with a single tool covering all type x optionality combinations
# ---------------------------------------------------------------------------

server = MCPServer(name="SchemaTestServer")


@server.tool(name="all_types", description="Exercises every type combination.")
def all_types(
    # --- required (no default) ---
    req_str: Annotated[str, Field(description="Required string")],
    req_int: Annotated[int, Field(description="Required integer")],
    req_bool: Annotated[bool, Field(description="Required boolean")],
    req_float: Annotated[float, Field(description="Required float")],
    req_list: Annotated[list[str], Field(description="Required list of strings")],
    # --- optional with non-None default ---
    opt_str: Annotated[str, Field(description="Optional string with default")] = "en",
    opt_int: Annotated[int, Field(description="Optional int with default")] = 10,
    opt_bool: Annotated[bool, Field(description="Optional bool with default")] = False,
    # --- nullable (T | None, default None) ---
    nullable_str: Annotated[str | None, Field(description="Nullable string")] = None,
    nullable_int: Annotated[int | None, Field(description="Nullable integer")] = None,
    nullable_bool: Annotated[bool | None, Field(description="Nullable boolean")] = None,
    nullable_float: Annotated[float | None, Field(description="Nullable float")] = None,
    nullable_list: Annotated[list[str] | None, Field(description="Nullable list")] = None,
) -> dict:
    """Stub."""
    return {}


# ---------------------------------------------------------------------------
# Expected schema snapshot
# ---------------------------------------------------------------------------

EXPECTED_SCHEMA = {
    "properties": {
        "req_str": {"description": "Required string", "title": "Req Str", "type": "string"},
        "req_int": {"description": "Required integer", "title": "Req Int", "type": "integer"},
        "req_bool": {"description": "Required boolean", "title": "Req Bool", "type": "boolean"},
        "req_float": {"description": "Required float", "title": "Req Float", "type": "number"},
        "req_list": {
            "description": "Required list of strings",
            "items": {"type": "string"},
            "title": "Req List",
            "type": "array",
        },
        "opt_str": {
            "default": "en",
            "description": "Optional string with default",
            "title": "Opt Str",
            "type": "string",
        },
        "opt_int": {
            "default": 10,
            "description": "Optional int with default",
            "title": "Opt Int",
            "type": "integer",
        },
        "opt_bool": {
            "default": False,
            "description": "Optional bool with default",
            "title": "Opt Bool",
            "type": "boolean",
        },
        "nullable_str": {
            "default": None,
            "description": "Nullable string",
            "title": "Nullable Str",
            "type": "string",
        },
        "nullable_int": {
            "default": None,
            "description": "Nullable integer",
            "title": "Nullable Int",
            "type": "integer",
        },
        "nullable_bool": {
            "default": None,
            "description": "Nullable boolean",
            "title": "Nullable Bool",
            "type": "boolean",
        },
        "nullable_float": {
            "default": None,
            "description": "Nullable float",
            "title": "Nullable Float",
            "type": "number",
        },
        "nullable_list": {
            "default": None,
            "description": "Nullable list",
            "items": {"type": "string"},
            "title": "Nullable List",
            "type": "array",
        },
    },
    "required": ["req_str", "req_int", "req_bool", "req_float", "req_list"],
    "title": "all_typesArguments",
    "type": "object",
}

REQUIRED_FIELDS = {"req_str", "req_int", "req_bool", "req_float", "req_list"}
OPTIONAL_FIELDS = {"opt_str", "opt_int", "opt_bool"}
NULLABLE_FIELDS = {"nullable_str", "nullable_int", "nullable_bool", "nullable_float", "nullable_list"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _schema() -> dict:
    tool = server._tool_manager.get_tool("all_types")
    assert tool is not None
    return tool.parameters


def _props() -> dict:
    return _schema()["properties"]


# ---------------------------------------------------------------------------
# Tests: Full snapshot
# ---------------------------------------------------------------------------


class TestSchemaSnapshot:
    def test_matches_expected(self):
        assert _schema() == EXPECTED_SCHEMA


# ---------------------------------------------------------------------------
# Tests: anyOf removal (the core fix)
# ---------------------------------------------------------------------------


class TestAnyOfRemoval:
    """Nullable fields must NOT use anyOf — they get a flat 'type' instead."""

    def test_no_property_has_any_of(self):
        for name, prop in _props().items():
            assert "anyOf" not in prop, f"'{name}' still has anyOf: {prop}"

    @pytest.mark.asyncio
    async def test_no_any_of_on_wire(self):
        """Same check via list_tools() — the actual wire path."""
        tools = await server.list_tools()
        tool = next(t for t in tools if t.name == "all_types")
        for name, prop in tool.inputSchema["properties"].items():
            assert "anyOf" not in prop, f"'{name}' has anyOf on wire"


# ---------------------------------------------------------------------------
# Tests: Every property has type and description
# ---------------------------------------------------------------------------


class TestPropertyCompleteness:
    def test_every_property_has_type(self):
        for name, prop in _props().items():
            assert "type" in prop, f"'{name}' missing 'type'"

    def test_every_property_has_description(self):
        for name, prop in _props().items():
            assert prop.get("description"), f"'{name}' missing or empty description"


# ---------------------------------------------------------------------------
# Tests: Type mapping
# ---------------------------------------------------------------------------


class TestTypeMapping:
    @pytest.mark.parametrize(
        ("field", "expected_type"),
        [
            ("req_str", "string"),
            ("req_int", "integer"),
            ("req_bool", "boolean"),
            ("req_float", "number"),
            ("req_list", "array"),
            ("opt_str", "string"),
            ("opt_int", "integer"),
            ("opt_bool", "boolean"),
            ("nullable_str", "string"),
            ("nullable_int", "integer"),
            ("nullable_bool", "boolean"),
            ("nullable_float", "number"),
            ("nullable_list", "array"),
        ],
    )
    def test_type(self, field: str, expected_type: str):
        assert _props()[field]["type"] == expected_type

    def test_array_items(self):
        assert _props()["req_list"]["items"] == {"type": "string"}
        assert _props()["nullable_list"]["items"] == {"type": "string"}


# ---------------------------------------------------------------------------
# Tests: Required / optional / nullable classification
# ---------------------------------------------------------------------------


class TestRequiredOptional:
    def test_required_fields(self):
        assert set(_schema().get("required", [])) == REQUIRED_FIELDS

    def test_optional_not_required(self):
        required = set(_schema().get("required", []))
        assert required & OPTIONAL_FIELDS == set()
        assert required & NULLABLE_FIELDS == set()

    def test_defaults_non_none(self):
        props = _props()
        assert props["opt_str"]["default"] == "en"
        assert props["opt_int"]["default"] == 10
        assert props["opt_bool"]["default"] is False

    def test_nullable_defaults_none(self):
        props = _props()
        for field in NULLABLE_FIELDS:
            assert props[field]["default"] is None, f"'{field}' default should be None"
