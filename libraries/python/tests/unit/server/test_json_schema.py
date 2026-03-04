"""Tests for MCP-compliant JSON Schema simplification."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field, create_model

from mcp_use.server.utils.json_schema import simplify_optional_schema

# ---------------------------------------------------------------------------
# Helpers — build realistic schemas via Pydantic so we test the real output
# ---------------------------------------------------------------------------


def _schema_for(**fields) -> dict:
    """Create a Pydantic model from *fields* and return its JSON schema."""
    model = create_model("TestModel", **fields)
    return model.model_json_schema()


# ---------------------------------------------------------------------------
# Core simplification
# ---------------------------------------------------------------------------


class TestSimplifyNullableAnyOf:
    """Nullable anyOf patterns are collapsed to the base type."""

    def test_optional_str(self):
        schema = _schema_for(
            name=(Annotated[str | None, Field(description="A name")], None),
        )
        result = simplify_optional_schema(schema)
        prop = result["properties"]["name"]

        assert "anyOf" not in prop
        assert prop["type"] == "string"
        assert prop["description"] == "A name"
        assert prop["default"] is None

    def test_optional_int(self):
        schema = _schema_for(
            count=(Annotated[int | None, Field(description="A count")], None),
        )
        result = simplify_optional_schema(schema)
        prop = result["properties"]["count"]

        assert "anyOf" not in prop
        assert prop["type"] == "integer"
        assert prop["description"] == "A count"

    def test_optional_bool(self):
        schema = _schema_for(
            flag=(Annotated[bool | None, Field(description="A flag")], None),
        )
        result = simplify_optional_schema(schema)
        prop = result["properties"]["flag"]

        assert "anyOf" not in prop
        assert prop["type"] == "boolean"

    def test_optional_list(self):
        schema = _schema_for(
            tags=(Annotated[list[str] | None, Field(description="Tags")], None),
        )
        result = simplify_optional_schema(schema)
        prop = result["properties"]["tags"]

        assert "anyOf" not in prop
        assert prop["type"] == "array"
        assert prop["items"] == {"type": "string"}
        assert prop["description"] == "Tags"


# ---------------------------------------------------------------------------
# Metadata preservation
# ---------------------------------------------------------------------------


class TestMetadataPreservation:
    """description, default, and title are kept after simplification."""

    def test_all_metadata_preserved(self):
        schema = _schema_for(
            company=(
                Annotated[str | None, Field(description="Company name", title="Company")],
                None,
            ),
        )
        result = simplify_optional_schema(schema)
        prop = result["properties"]["company"]

        assert prop["description"] == "Company name"
        assert prop["title"] == "Company"
        assert prop["default"] is None

    def test_non_optional_field_unchanged(self):
        schema = _schema_for(
            language=(Annotated[str, Field(description="Language code")], "it"),
        )
        result = simplify_optional_schema(schema)
        prop = result["properties"]["language"]

        assert prop["type"] == "string"
        assert prop["description"] == "Language code"
        assert prop["default"] == "it"


# ---------------------------------------------------------------------------
# Edge cases — should NOT simplify
# ---------------------------------------------------------------------------


class TestComplexAnyOfUntouched:
    """anyOf with >2 entries or $ref schemas are left as-is."""

    def test_three_way_anyof_left_alone(self):
        schema = {
            "properties": {
                "value": {
                    "anyOf": [
                        {"type": "string"},
                        {"type": "integer"},
                        {"type": "null"},
                    ],
                    "description": "Multi-type",
                }
            }
        }
        result = simplify_optional_schema(schema)
        assert "anyOf" in result["properties"]["value"]

    def test_ref_anyof_left_alone(self):
        schema = {
            "properties": {
                "address": {
                    "anyOf": [
                        {"$ref": "#/$defs/Address"},
                        {"type": "null"},
                    ],
                    "description": "Optional ref",
                }
            }
        }
        result = simplify_optional_schema(schema)
        assert "anyOf" in result["properties"]["address"]

    def test_empty_properties(self):
        schema = {"type": "object", "properties": {}}
        result = simplify_optional_schema(schema)
        assert result == schema

    def test_no_properties_key(self):
        schema = {"type": "object"}
        result = simplify_optional_schema(schema)
        assert result == schema


# ---------------------------------------------------------------------------
# Original schema is not mutated
# ---------------------------------------------------------------------------


class TestImmutability:
    """simplify_optional_schema returns a new dict, never mutates the input."""

    def test_original_unchanged(self):
        schema = _schema_for(
            name=(Annotated[str | None, Field(description="A name")], None),
        )
        original_prop = schema["properties"]["name"].copy()

        simplify_optional_schema(schema)

        assert schema["properties"]["name"] == original_prop


# ---------------------------------------------------------------------------
# Full round-trip: Pydantic model → simplify → verify
# ---------------------------------------------------------------------------


class TestFullRoundTrip:
    """Simulate the real tool schema pipeline."""

    def test_mixed_optional_and_required(self):
        schema = _schema_for(
            query=(Annotated[str | None, Field(description="Search query")], None),
            company=(Annotated[str | None, Field(description="Company filter")], None),
            language=(Annotated[str, Field(description="Language code")], "it"),
            limit=(Annotated[int, Field(description="Max results")], 10),
            days=(Annotated[int | None, Field(description="Lookback days")], None),
        )
        result = simplify_optional_schema(schema)

        # Optional fields: simplified
        for name in ("query", "company", "days"):
            prop = result["properties"][name]
            assert "anyOf" not in prop, f"{name} still has anyOf"
            assert "description" in prop, f"{name} lost its description"

        # Non-optional fields: unchanged
        assert result["properties"]["language"]["type"] == "string"
        assert result["properties"]["limit"]["type"] == "integer"
