"""Utilities for producing MCP-compliant JSON Schemas.

Pydantic represents ``Optional[T]`` as ``{"anyOf": [{"type": "T"}, {"type":
"null"}]}``.  While valid JSON Schema, this is not idiomatic MCP — the protocol
signals optionality by omitting the property from the ``required`` array.  The
``anyOf``/null pattern also confuses several MCP clients (e.g. the Inspector)
which fail to render descriptions for those fields.

``simplify_optional_schema`` walks a JSON Schema object and collapses every
nullable ``anyOf`` into the simpler ``{"type": "T"}`` form.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

# Keys that live at the property level and must be preserved when we
# replace the ``anyOf`` wrapper with the inner type schema.
_PROPERTY_KEYS = ("description", "default", "title", "examples")

_NULL_SCHEMA = {"type": "null"}


def _is_nullable_any_of(any_of: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the non-null branch if *any_of* is exactly ``[<type>, null]``.

    Returns ``None`` when the pattern is more complex (``$ref`` schemas,
    >2 entries, …) so the caller can leave it untouched.
    """
    if len(any_of) != 2:
        return None

    first, second = any_of
    if second == _NULL_SCHEMA:
        base = first
    elif first == _NULL_SCHEMA:
        base = second
    else:
        return None

    # ``$ref`` schemas resolve to definitions elsewhere in the document —
    # stripping the ``anyOf`` wrapper would lose the nullable semantics.
    if "$ref" in base:
        return None

    return base


def _simplify_property(prop: dict[str, Any]) -> dict[str, Any]:
    """Return a simplified version of a single property schema.

    If *prop* contains a nullable ``anyOf`` of the form ``[<type>, null]``,
    returns a new dict based on the non-null branch with metadata preserved
    from the outer property.  For all other schemas the original *prop* dict
    is returned unchanged.  The input is never mutated.
    """
    any_of = prop.get("anyOf")
    if any_of is None:
        return prop

    base_type = _is_nullable_any_of(any_of)
    if base_type is None:
        # Complex anyOf — leave untouched
        return prop

    # Build the simplified property: start from the base type, overlay
    # any metadata that Pydantic placed at the outer level.
    simplified = dict(base_type)
    for key in _PROPERTY_KEYS:
        if key in prop:
            simplified[key] = prop[key]

    return simplified


def simplify_optional_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Return *schema* with nullable ``anyOf`` patterns simplified.

    Returns a deep copy when properties need simplification.  When the schema
    has no ``properties`` key (or it is empty), the original dict is returned
    as-is since there is nothing to transform.

    Only touches ``properties`` of the top-level object schema — nested
    ``$defs`` and deeply nested objects are left as-is since MCP tool schemas
    are typically flat.
    """
    properties = schema.get("properties")
    if not properties:
        return schema

    schema = deepcopy(schema)
    schema["properties"] = {name: _simplify_property(prop) for name, prop in schema["properties"].items()}
    return schema
