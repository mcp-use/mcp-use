"""This module defines the data structures for tools that can be used with a Large Language Model."""

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any, Literal, Self


def _clean_none(d: Any) -> Any:
    """Recursively remove None values from a dictionary or list.

    Args:
        d: The dictionary or list to clean.

    Returns:
        The cleaned dictionary or list.
    """
    if isinstance(d, dict):
        return {k: _clean_none(v) for k, v in d.items() if v is not None}
    if isinstance(d, list):
        return [_clean_none(i) for i in d]
    return d


@dataclass
class ParameterProperty:
    """Defines a property of a parameter in a tool's function.

    This class corresponds to a JSON Schema property definition.

    Attributes:
        type: The data type of the property (e.g., 'string', 'number').
        description: A description of the property.
        enum: A list of possible values for the property.
        items: A dictionary describing the items if the type is 'array'.
        properties: A dictionary of sub-properties if the type is 'object'.
        required: A list of required sub-properties if the type is 'object'.
    """

    type: str
    description: str | None = None
    enum: list[str] | None = None
    # Add other JSON Schema properties as needed
    items: dict[str, Any] | None = None
    properties: dict[str, Self] | None = None
    required: list[str] | None = None


@dataclass
class Parameters:
    """Defines the parameters for a tool's function.

    Attributes:
        type: The type of the parameters object, which must be 'object'.
        properties: A dictionary mapping parameter names to their definitions.
        required: A list of required parameter names.
    """

    type: Literal["object"]
    properties: dict[str, ParameterProperty]
    required: list[str] | None = None


@dataclass
class CacheControl:
    """Defines caching behavior for a tool's function.

    Attributes:
        type: The type of cache control. Currently, only 'ephemeral' is supported.
    """

    type: Literal["ephemeral"]


@dataclass
class FunctionDefinition:
    """Defines a function that a tool can execute.

    Attributes:
        name: The name of the function.
        description: A description of what the function does.
        parameters: The parameters the function accepts.
        cache_control: The caching behavior for the function.
    """

    name: str
    description: str
    parameters: Parameters
    cache_control: CacheControl | None = None


@dataclass
class Tool:
    """Represents a tool that the LLM can use.

    Attributes:
        type: The type of the tool. Currently, only 'function' is supported.
        name: The name of the tool.
        description: The description of the tool.
        parameters: The parameters of the tool.
        cache_control: The caching behavior for the tool.
        callable: The actual Python function to call.
    """

    type: Literal["function"]
    name: str | None = None
    description: str | None = None
    parameters: Parameters | None = None
    cache_control: CacheControl | None = None
    callable: Callable[..., Any] | None = None

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Execute the tool's callable.

        Raises:
            TypeError: If the tool does not have a callable function.

        Returns:
            The result of the callable function.
        """
        if self.callable is None:
            raise TypeError("Tool is not callable.")
        return self.callable(*args, **kwargs)

    def to_litellm(self) -> dict[str, Any]:
        """Convert the tool to a JSON-serializable dictionary.

        The 'callable' attribute is excluded from the output.

        Returns:
            A dictionary representation of the tool.
        """
        tool_definition = FunctionDefinition(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
            cache_control=self.cache_control,
        )

        return _clean_none(
            {
                "type": "function",
                "function": asdict(tool_definition),
            }
        )
