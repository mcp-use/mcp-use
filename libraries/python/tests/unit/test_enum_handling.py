"""
Unit tests for enum handling in LangChain adapter.
"""

import unittest
from enum import Enum
from unittest.mock import Mock

from jsonschema_pydantic import jsonschema_to_pydantic
from pydantic import BaseModel, ValidationError

from mcp_use.adapters.langchain_adapter import LangChainAdapter


class TestEnumHandling(unittest.TestCase):
    """Test enum handling in LangChain adapter."""

    def setUp(self):
        """Set up test fixtures."""
        self.adapter = LangChainAdapter()

    def test_fix_schema_with_enum(self):
        """Test that fix_schema properly handles enum fields."""
        # Schema with enum but no explicit type
        schema_with_enum = {"type": "object", "properties": {"code_type": {"enum": ["x", "y", "z"]}}}

        fixed_schema = self.adapter.fix_schema(schema_with_enum)

        # Check that enum field now has type: "string"
        self.assertIn("type", fixed_schema["properties"]["code_type"])
        self.assertEqual(fixed_schema["properties"]["code_type"]["type"], "string")
        self.assertIn("enum", fixed_schema["properties"]["code_type"])

    def test_fix_schema_preserves_existing_type(self):
        """Test that fix_schema doesn't override existing type for enum fields."""
        # Schema with enum and explicit type
        schema_with_enum_and_type = {
            "type": "object",
            "properties": {"code_type": {"type": "string", "enum": ["x", "y", "z"]}},
        }

        fixed_schema = self.adapter.fix_schema(schema_with_enum_and_type)

        # Check that existing type is preserved
        self.assertEqual(fixed_schema["properties"]["code_type"]["type"], "string")
        self.assertIn("enum", fixed_schema["properties"]["code_type"])

    def test_enum_validation_works_after_fix(self):
        """Test that enum validation works correctly after applying the fix."""
        # Create a schema that would cause the original issue
        problematic_schema = {
            "type": "object",
            "properties": {"age": {"type": "integer"}, "code_type": {"enum": ["x", "y", "z"]}},
            "required": ["age", "code_type"],
        }

        # Apply the fix
        fixed_schema = self.adapter.fix_schema(problematic_schema)

        # Convert to Pydantic model
        DynamicModel = jsonschema_to_pydantic(fixed_schema)

        # Test with valid data
        test_data = {"age": 25, "code_type": "x"}

        # This should work without validation errors
        instance = DynamicModel(**test_data)
        self.assertEqual(instance.age, 25)
        self.assertEqual(instance.code_type, "x")

    def test_enum_validation_accepts_valid_values(self):
        """Test that enum validation accepts valid enum values."""
        # Create a schema with enum
        schema_with_enum = {
            "type": "object",
            "properties": {"code_type": {"type": "string", "enum": ["x", "y", "z"]}},
            "required": ["code_type"],
        }

        # Apply the fix
        fixed_schema = self.adapter.fix_schema(schema_with_enum)

        # Convert to Pydantic model
        DynamicModel = jsonschema_to_pydantic(fixed_schema)

        # Test with valid enum values
        for valid_value in ["x", "y", "z"]:
            test_data = {"code_type": valid_value}
            # This should work without validation errors
            instance = DynamicModel(**test_data)
            self.assertEqual(instance.code_type, valid_value)

    def test_recursive_schema_fixing(self):
        """Test that schema fixing works recursively."""
        nested_schema = {
            "type": "object",
            "properties": {"nested": {"type": "object", "properties": {"code_type": {"enum": ["a", "b", "c"]}}}},
        }

        fixed_schema = self.adapter.fix_schema(nested_schema)

        # Check that nested enum field is fixed
        nested_props = fixed_schema["properties"]["nested"]["properties"]
        self.assertIn("type", nested_props["code_type"])
        self.assertEqual(nested_props["code_type"]["type"], "string")


if __name__ == "__main__":
    unittest.main()
