#!/usr/bin/env python3
"""
Script to generate Mintlify-compatible MDX API documentation files and update docs.json.
Organizes files by path structure and excludes __init__.py files.
"""

import inspect
import json
import os
import sys
from pathlib import Path
from typing import Any, Union

# Global constant for gradient generator URL
GRADIENT_GENERATOR_URL = "http://localhost:3000/gradient-generator/api/random?width=800&height=100"


def get_docstring(obj: Any) -> str:
    """Extract docstring from an object."""
    if hasattr(obj, "__doc__") and obj.__doc__:
        return obj.__doc__.strip()
    return ""


def format_type_annotation(annotation: Any) -> str:
    """Format type annotation for display."""
    if annotation is None or annotation is type(None):
        return "None"

    # Handle GenericAlias (Python 3.9+)
    if hasattr(annotation, "__origin__") and hasattr(annotation, "__args__"):
        origin = annotation.__origin__
        args = annotation.__args__

        if origin is Union:
            if args and args[-1] is type(None):
                # Optional type
                non_none_args = [arg for arg in args if arg is not type(None)]
                if len(non_none_args) == 1:
                    return f"{format_type_annotation(non_none_args[0])} | None"
                else:
                    return " | ".join(format_type_annotation(arg) for arg in non_none_args) + " | None"
            else:
                return " | ".join(format_type_annotation(arg) for arg in args)
        elif origin is list:
            if args:
                return f"list[{format_type_annotation(args[0])}]"
            return "list"
        elif origin is dict:
            if len(args) >= 2:
                return f"dict[{format_type_annotation(args[0])}, {format_type_annotation(args[1])}]"
            return "dict"
        elif origin is tuple:
            if args:
                return f"tuple[{', '.join(format_type_annotation(arg) for arg in args)}]"
            return "tuple"
        elif origin is set:
            if args:
                return f"set[{format_type_annotation(args[0])}]"
            return "set"

    # Handle regular types - show full import path
    if hasattr(annotation, "__module__") and hasattr(annotation, "__name__"):
        module = annotation.__module__
        name = annotation.__name__
        # Skip built-in types and common stdlib types
        if module in ("builtins", "typing", "collections.abc") or module.startswith("typing"):
            return name
        # For external modules, show the full path
        return f"{module}.{name}"
    elif hasattr(annotation, "__name__"):
        return annotation.__name__
    elif isinstance(annotation, str):
        return annotation

    return str(annotation)


def process_docstring(docstring: str) -> str:
    """Process docstring to convert code blocks, escape problematic characters, and remove Args section."""
    if not docstring:
        return ""

    lines = docstring.split("\n")
    processed_lines = []
    in_code_block = False
    in_args_section = False
    skip_line = False

    for _, line in enumerate(lines):
        stripped = line.strip()

        # Skip if we're in a line that should be skipped
        if skip_line:
            skip_line = False
            continue

        # Handle Sphinx-style code blocks
        if stripped.startswith(".. code-block::"):
            in_code_block = True
            processed_lines.append("```python wrap")
            continue
        elif in_code_block and stripped and not line.startswith(" ") and not line.startswith("\t"):
            # End of code block
            in_code_block = False
            processed_lines.append("```")
            processed_lines.append("")
            processed_lines.append(line)
            continue
        elif in_code_block:
            # Inside code block - escape curly braces in comments
            if "#" in line:
                line = line.replace("{", "\\{").replace("}", "\\}")
            processed_lines.append(line)
        else:
            # Check for Args:, Parameters:, Returns:, Warns:, Raises: sections
            if stripped.lower().startswith(
                ("args:", "parameters:", "returns:", "return:", "warns:", "warn:", "raises:", "raise:")
            ):
                in_args_section = True
                skip_line = True  # Skip the section header line itself
                continue
            # Check for end of section
            elif in_args_section and stripped.lower().startswith(("yields:", "note:", "example:", "usage:")):
                in_args_section = False
                processed_lines.append(line)
            # Skip lines in args section
            elif in_args_section:
                # Check if this line starts a new section (not indented)
                if stripped and not line.startswith(" ") and not line.startswith("\t") and ":" in stripped:
                    in_args_section = False
                    processed_lines.append(line)
                # Otherwise skip this line (it's part of args section)
                continue
            else:
                # Outside code block and args section - escape curly braces
                line = line.replace("{", "\\{").replace("}", "\\}")
                processed_lines.append(line)

    # Close any open code block
    if in_code_block:
        processed_lines.append("```")

    return "\n".join(processed_lines)


def format_signature(func: Any) -> str:
    """Format function signature for display."""
    try:
        sig = inspect.signature(func)
        params = []
        for name, param in sig.parameters.items():
            if name == "self":
                continue
            param_str = name
            if param.annotation != inspect.Signature.empty:
                param_str += f": {format_type_annotation(param.annotation)}"
            if param.default != inspect.Signature.empty:
                if isinstance(param.default, str):
                    param_str += f' = "{param.default}"'
                else:
                    param_str += f" = {param.default}"
            params.append(param_str)
        return f"({', '.join(params)})"
    except Exception:
        return "()"


def extract_param_docs(docstring: str) -> dict[str, str]:
    """Extract parameter descriptions from docstring."""
    param_docs = {}
    if not docstring:
        return param_docs

    lines = docstring.split("\n")
    current_param = None
    current_desc = []
    in_args_section = False

    for line in lines:
        stripped = line.strip()

        # Sphinx style: :param name: description
        if stripped.startswith(":param "):
            if current_param and current_desc:
                param_docs[current_param] = " ".join(current_desc).strip()
            parts = stripped[7:].split(":", 1)
            if len(parts) == 2:
                current_param = parts[0].strip()
                current_desc = [parts[1].strip()] if parts[1].strip() else []
            else:
                current_param = parts[0].strip()
                current_desc = []
        # Google style: Args: or Parameters:
        elif stripped.lower().startswith(("args:", "parameters:")):
            in_args_section = True
            current_param = None
            current_desc = []
        # Google style: name (type): description
        elif in_args_section and ":" in stripped and not stripped.startswith(" "):
            if current_param and current_desc:
                param_docs[current_param] = " ".join(current_desc).strip()
            parts = stripped.split(":", 1)
            if len(parts) == 2:
                param_part = parts[0].strip()
                if "(" in param_part and ")" in param_part:
                    param_name = param_part.split("(")[0].strip()
                    current_param = param_name
                    current_desc = [parts[1].strip()] if parts[1].strip() else []
                else:
                    # Simple parameter name without type
                    current_param = param_part
                    current_desc = [parts[1].strip()] if parts[1].strip() else []
        # Continuation of current parameter description
        elif current_param and (stripped.startswith(" ") or stripped == "" or stripped.startswith("-")):
            if stripped:
                current_desc.append(stripped)
        # End of args section
        elif in_args_section and stripped.lower().startswith(("returns:", "raises:", "yields:", "note:", "example:")):
            if current_param and current_desc:
                param_docs[current_param] = " ".join(current_desc).strip()
            in_args_section = False
            current_param = None
            current_desc = []
        else:
            if current_param and current_desc:
                param_docs[current_param] = " ".join(current_desc).strip()
            current_param = None
            current_desc = []

    # Add the last parameter
    if current_param and current_desc:
        param_docs[current_param] = " ".join(current_desc).strip()

    return param_docs


def generate_param_field(name: str, param: inspect.Parameter, description: str) -> str:
    """Generate ParamField component for a parameter."""
    param_type = ""
    default_value = ""

    if param.annotation != inspect.Signature.empty:
        param_type = format_type_annotation(param.annotation)

    if param.default != inspect.Signature.empty:
        if isinstance(param.default, str):
            # Use single quotes for string defaults to avoid JSX parsing issues
            default_value = f"'{param.default}'"
        else:
            # Always quote non-string defaults to avoid JSX parsing issues
            default_value = f'"{str(param.default)}"'

    field_parts = [f'<ParamField body="{name}"']

    if param_type:
        field_parts.append(f'type="{param_type}"')

    if default_value:
        field_parts.append(f"default={default_value}")
    else:
        # Add required="True" for parameters without default values
        field_parts.append('required="True"')

    field_parts.append(">")

    if description and description.strip():
        field_parts.append(f"  {description.strip()}")
    else:
        # Provide more helpful default descriptions based on parameter name
        default_desc = get_default_param_description(name, param_type)
        field_parts.append(f"  {default_desc}")

    field_parts.append("</ParamField>")

    return " ".join(field_parts)


def get_default_param_description(name: str, param_type: str) -> str:
    """Generate a helpful default description for a parameter."""
    name_lower = name.lower()

    # Common parameter patterns
    if "config" in name_lower:
        return "Configuration object or file path"
    elif "session" in name_lower:
        return "MCP session instance"
    elif "client" in name_lower:
        return "MCP client instance"
    elif "server" in name_lower:
        return "Server name or configuration"
    elif "query" in name_lower:
        return "Query string or input"
    elif "callback" in name_lower:
        return "Callback function"
    elif "middleware" in name_lower:
        return "Middleware instance"
    elif "connector" in name_lower:
        return "Connector instance"
    elif "tools" in name_lower:
        return "List of tools"
    elif "name" in name_lower:
        return "Name identifier"
    elif "path" in name_lower or "filepath" in name_lower:
        return "File path"
    elif "url" in name_lower:
        return "URL string"
    elif "timeout" in name_lower:
        return "Timeout duration"
    elif "retries" in name_lower:
        return "Number of retry attempts"
    elif "debug" in name_lower or "verbose" in name_lower:
        return "Enable debug/verbose mode"
    elif "async" in name_lower:
        return "Enable asynchronous mode"
    elif "auto" in name_lower:
        return "Enable automatic behavior"
    elif param_type and "bool" in param_type.lower():
        return "Boolean flag"
    elif param_type and "list" in param_type.lower():
        return "List of items"
    elif param_type and "dict" in param_type.lower():
        return "Dictionary of key-value pairs"
    elif param_type and "str" in param_type.lower():
        return "String value"
    elif param_type and "int" in param_type.lower():
        return "Integer value"
    else:
        return "Parameter value"


def extract_return_docs(docstring: str) -> str:
    """Extract return value description from docstring."""
    if not docstring:
        return ""

    lines = docstring.split("\n")
    in_returns_section = False
    return_desc = []

    for line in lines:
        stripped = line.strip()

        # Sphinx style: :returns: or :return:
        if stripped.startswith((":returns:", ":return:")):
            return_desc.append(stripped.split(":", 1)[1].strip())
            in_returns_section = True
        # Google style: Returns: or Return: (handle indented)
        elif stripped.lower().endswith(("returns:", "return:")):
            # Extract the description part after the colon
            desc_part = stripped.split(":", 1)[1].strip()
            if desc_part:
                return_desc.append(desc_part)
            in_returns_section = True
        # Continuation of return description
        elif in_returns_section and (line.startswith(" ") or stripped == "" or stripped.startswith("-")):
            # Check if this line starts a new section (like "Example:")
            if stripped and stripped.lower().endswith(":"):
                break
            if stripped:
                return_desc.append(stripped)
        # End of returns section
        elif in_returns_section and stripped.lower().startswith(
            ("raises:", "yields:", "note:", "example:", "args:", "parameters:", "warns:", "warn:")
        ):
            break

    return " ".join(return_desc).strip()


def extract_warns_docs(docstring: str) -> list[str]:
    """Extract warns documentation from docstring."""
    if not docstring:
        return []

    lines = docstring.split("\n")
    in_warns_section = False
    warn_desc = []

    for line in lines:
        stripped = line.strip()

        # Sphinx style: :warns: or :warn:
        if stripped.startswith((":warns:", ":warn:")):
            warn_desc.append(stripped.split(":", 1)[1].strip())
            in_warns_section = True
        # Google style: Warns: or Warn:
        elif stripped.lower().startswith(("warns:", "warn:")):
            warn_desc.append(stripped.split(":", 1)[1].strip())
            in_warns_section = True
        # Continuation of warn description
        elif in_warns_section and (stripped.startswith(" ") or stripped == "" or stripped.startswith("-")):
            if stripped:
                warn_desc.append(stripped)
        # End of warns section
        elif in_warns_section and stripped.lower().startswith(
            ("raises:", "yields:", "note:", "example:", "args:", "parameters:", "returns:", "return:")
        ):
            break

    return warn_desc


def extract_raises_docs(docstring: str) -> list[str]:
    """Extract raises documentation from docstring."""
    if not docstring:
        return []

    lines = docstring.split("\n")
    in_raises_section = False
    raise_desc = []

    for line in lines:
        stripped = line.strip()

        # Sphinx style: :raises: or :raise:
        if stripped.startswith((":raises:", ":raise:")):
            raise_desc.append(stripped.split(":", 1)[1].strip())
            in_raises_section = True
        # Google style: Raises: or Raise:
        elif stripped.lower().startswith(("raises:", "raise:")):
            raise_desc.append(stripped.split(":", 1)[1].strip())
            in_raises_section = True
        # Continuation of raise description
        elif in_raises_section and (stripped.startswith(" ") or stripped == "" or stripped.startswith("-")):
            if stripped:
                raise_desc.append(stripped)
        # End of raises section
        elif in_raises_section and stripped.lower().startswith(
            ("warns:", "warn:", "yields:", "note:", "example:", "args:", "parameters:", "returns:", "return:")
        ):
            break

    return raise_desc


def generate_module_description(module_name: str, module_docstring: str) -> str:
    """Generate a better description for a module."""
    if module_docstring and module_docstring.strip():
        # Use the first sentence of the docstring
        first_sentence = module_docstring.strip().split(".")[0].strip()
        if first_sentence:
            return f"{first_sentence} API Documentation"

    # Fallback to generic description
    return f"{module_name.split('.')[-1].replace('_', ' ').title()} API Documentation"


def generate_response_field(name: str, field_type: str, description: str = "") -> str:
    """Generate ResponseField component with enhanced formatting."""
    field_parts = [f'<ResponseField name="{name}"']

    if field_type and field_type.strip():
        field_parts.append(f'type="{field_type}"')

    if description:
        # Escape quotes in description
        escaped_desc = description.replace('"', "&quot;")
        field_parts.append(f">{escaped_desc}</ResponseField>")
    else:
        field_parts.append("/>")

    return " ".join(field_parts)


def is_defined_in_module(obj: Any, module_name: str) -> bool:
    """Check if an object is defined in the specified module."""
    if hasattr(obj, "__module__"):
        return obj.__module__ == module_name
    return False


def generate_class_docs(cls: type, module_name: str) -> str:
    """Generate documentation for a class."""
    docs = []

    # Class header
    class_name = cls.__name__
    docstring = get_docstring(cls)

    # Class section header for sidebar
    docs.append(f"## {class_name}")
    docs.append("")

    # Class Card with image
    docs.append('<Card type="info" img="http://localhost:3000/gradient-generator/api/random?width=800&height=50">')
    docs.append(f"### `class` {class_name}")
    docs.append("")

    if docstring:
        docs.append(process_docstring(docstring))
        docs.append("")

    # Class attributes/fields - focus on type annotations for Pydantic models
    class_attributes = []

    # Check for annotations that are likely user-defined fields
    if hasattr(cls, "__annotations__"):
        for name, annotation in cls.__annotations__.items():
            # Skip private attributes and Pydantic internal fields
            if (
                not name.startswith("_")
                and not name.startswith("model_")
                and name not in ["computed_fields", "config", "extra", "fields", "fields_set"]
            ):
                class_attributes.append((name, annotation))

    if class_attributes:
        docs.append("**Attributes**")
        docs.append(">")
        for name, annotation in class_attributes:
            # Create a mock parameter object for the annotation
            from inspect import Parameter

            param = Parameter(name, Parameter.POSITIONAL_OR_KEYWORD, annotation=annotation)
            param_field = generate_param_field(name, param, "")
            docs.append(param_field)
        docs.append("")

    # Constructor
    if hasattr(cls, "__init__"):
        init_method = cls.__init__
        if init_method != object.__init__:
            # Constructor Card with image
            docs.append(
                '<Card type="info" img="http://localhost:3000/gradient-generator/api/random?width=800&height=50">'
            )
            docs.append("### `method` __init__")
            docs.append("")

            try:
                init_docstring = get_docstring(init_method)
                sig = inspect.signature(init_method)
                param_docs = extract_param_docs(get_docstring(init_method))
                params_to_show = [(name, param) for name, param in sig.parameters.items() if name != "self"]

                # Add description outside callout
                if init_docstring:
                    docs.append(process_docstring(init_docstring))
                    docs.append("")

                # Add parameters in callout
                if params_to_show:
                    docs.append("**Parameters**")
                    for name, param in params_to_show:
                        param_doc = param_docs.get(name, "")
                        param_field = generate_param_field(name, param, param_doc)
                        docs.append(f">{param_field}")
                    docs.append("")

                # Constructor signature
                docs.append("**Signature**")
                docs.append("```python wrap")
                sig_str = format_signature(init_method)
                docs.append(f"def __init__{sig_str}:")
                docs.append("```")
                docs.append("")
            except Exception:
                docs.append("Error generating parameters")
                docs.append("")

            # Close the constructor Card
            docs.append("</Card>")
            docs.append("")

    # Methods - only include methods defined in this module (including async methods and properties)
    for name, method in inspect.getmembers(
        cls, predicate=lambda x: inspect.isfunction(x) or inspect.iscoroutinefunction(x) or isinstance(x, property)
    ):
        # For properties, check if the getter function is defined in this module
        is_property_in_module = False
        if isinstance(method, property):
            if hasattr(method, "fget") and method.fget:
                is_property_in_module = is_defined_in_module(method.fget, module_name)
        else:
            is_property_in_module = is_defined_in_module(method, module_name)

        # Skip inherited methods/properties - only show those defined in this class
        is_inherited = False
        if isinstance(method, property):
            if hasattr(method, "fget") and method.fget:
                # Check if this property is defined in a parent class
                for base_cls in cls.__bases__:
                    if hasattr(base_cls, name) and isinstance(getattr(base_cls, name), property):
                        is_inherited = True
                        break
        else:
            # Check if this method is defined in a parent class
            for base_cls in cls.__bases__:
                if hasattr(base_cls, name) and inspect.isfunction(getattr(base_cls, name)):
                    is_inherited = True
                    break

        if (
            (not name.startswith("_") or name in ["__call__", "__enter__", "__exit__"])
            and is_property_in_module
            and not is_inherited
        ):
            # Method/Property Card with image
            docs.append(
                '<Card type="info" img="http://localhost:3000/gradient-generator/api/random?width=800&height=50">'
            )
            if isinstance(method, property):
                docs.append(f"### `property` {name}")
            else:
                docs.append(f"### `method` {name}")
            docs.append("")

            method_docstring = get_docstring(method)

            # Handle properties differently from regular methods
            if isinstance(method, property):
                # Add description outside callout
                if method_docstring:
                    docs.append(process_docstring(method_docstring))
                    docs.append("")

                # Add return type for properties
                if hasattr(method, "fget") and method.fget:
                    sig = inspect.signature(method.fget)
                    return_annotation = sig.return_annotation
                    if return_annotation != inspect.Signature.empty:
                        docs.append("**Returns**")
                        docs.append(
                            f'><ResponseField name="returns" type="{format_type_annotation(return_annotation)}" />'
                        )
                        docs.append("")

                # Property signature
                docs.append("**Signature**")
                docs.append("```python wrap")
                docs.append(f"def {name}():")
                docs.append("```")
                docs.append("")
            else:
                # Regular method handling
                sig = inspect.signature(method)
                param_docs = extract_param_docs(get_docstring(method))
                params_to_show = [
                    (name_param, param) for name_param, param in sig.parameters.items() if name_param != "self"
                ]

                # Add description outside callout
                if method_docstring:
                    docs.append(process_docstring(method_docstring))
                    docs.append("")

                # Add parameters in callout
                if params_to_show:
                    docs.append("**Parameters**")
                    for name_param, param in params_to_show:
                        param_doc = param_docs.get(name_param, "")
                        param_field = generate_param_field(name_param, param, param_doc)
                        docs.append(f">{param_field}")
                    docs.append("")

            # Generate return type and signature
            try:
                # Return type (skip for properties as they're handled separately)
                if not isinstance(method, property) and sig.return_annotation != inspect.Signature.empty:
                    return_type = format_type_annotation(sig.return_annotation)
                    return_desc = extract_return_docs(get_docstring(method))

                    # Only show Returns section if there's a meaningful return type (not None)
                    if return_type not in ["None", "NoneType"]:
                        docs.append("**Returns**")
                        # Use ResponseField for better formatting
                        response_field = generate_response_field("returns", return_type, return_desc)
                        docs.append(f">{response_field}")
                        docs.append("")

                # Method signature (only for methods, not properties)
                if not isinstance(method, property):
                    docs.append("**Signature**")
                    docs.append("```python wrap")

                    sig_str = format_signature(method)
                    # Split long signatures across multiple lines
                    signature_line = f"def {name}{sig_str}:"
                    if len(signature_line) > 100:
                        # Split parameters for better readability
                        docs.append(f"def {name}(")
                        if sig_str != "()":
                            params = sig_str[1:-1].split(", ")
                            for i, param in enumerate(params):
                                prefix = "    " if i > 0 else ""
                                suffix = "," if i < len(params) - 1 else ""
                                docs.append(f"{prefix}{param}{suffix}")
                        docs.append("):")
                    else:
                        docs.append(signature_line)
                    docs.append("```")
                    docs.append("")
            except Exception:
                docs.append("Error generating parameters")
                docs.append("")

            # Close the method/property Card
            docs.append("</Card>")
            docs.append("")

    # Close the main class Card
    docs.append("</Card>")

    return "\n".join(docs)


def generate_function_docs(func: Any, module_name: str) -> str:
    """Generate documentation for a function."""
    docs = []

    func_name = func.__name__
    docstring = get_docstring(func)

    # Function section header for sidebar
    docs.append("")
    docs.append(f"## {func_name}")

    # Function Card with image
    docs.append('<Card type="info" img="http://localhost:3000/gradient-generator/api/random?width=800&height=50">')
    docs.append(f"### `function` {func_name}")
    docs.append("")

    # Function description
    if docstring:
        docs.append(process_docstring(docstring))
        docs.append("")

    # Parameters section
    sig = inspect.signature(func)
    param_docs = extract_param_docs(get_docstring(func))

    if sig.parameters:
        docs.append("**Parameters**")
        for name, param in sig.parameters.items():
            param_doc = param_docs.get(name, "")
            param_field = generate_param_field(name, param, param_doc)
            docs.append(f">{param_field}")
        docs.append("")

    # Returns section
    if sig.return_annotation != inspect.Signature.empty:
        return_type = format_type_annotation(sig.return_annotation)
        return_desc = extract_return_docs(get_docstring(func))

        # Only show Returns section if there's a meaningful return type (not None)
        if return_type not in ["None", "NoneType"]:
            docs.append("**Returns**")
            response_field = generate_response_field("returns", return_type, return_desc)
            docs.append(f">{response_field}")
            docs.append("")

    # Warns section
    warns_docs = extract_warns_docs(get_docstring(func))
    if warns_docs:
        docs.append("**Warns**")
        for warn in warns_docs:
            docs.append(f"><Warning>{warn}</Warning>")
        docs.append("")

    # Raises section
    raises_docs = extract_raises_docs(get_docstring(func))
    if raises_docs:
        docs.append("**Raises**")
        for raise_desc in raises_docs:
            docs.append(f"><Danger>{raise_desc}</Danger>")
        docs.append("")

    # Signature section
    docs.append("**Signature**")
    docs.append("```python wrap")

    try:
        sig_str = format_signature(func)
        # Split long signatures across multiple lines
        signature_line = f"def {func_name}{sig_str}:"
        if len(signature_line) > 100:
            # Split parameters for better readability
            docs.append(f"def {func_name}(")
            if sig_str != "()":
                params = sig_str[1:-1].split(", ")
                for i, param in enumerate(params):
                    prefix = "    " if i > 0 else ""
                    suffix = "," if i < len(params) - 1 else ""
                    docs.append(f"{prefix}{param}{suffix}")
            docs.append("):")
        else:
            docs.append(signature_line)
    except Exception:
        docs.append(f"def {func_name}():")

    docs.append("```")
    docs.append("</Card>")

    return "\n".join(docs)


def generate_module_docs(module_name: str, output_dir: str) -> None:
    """Generate MDX documentation for a module."""
    try:
        module = __import__(module_name, fromlist=[""])
    except ImportError as e:
        print(f"Error importing module {module_name}: {e}")
        return

    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Generate filename preserving module path structure
    filename = f"{module_name.replace('.', '_')}.mdx"
    output_path = os.path.join(output_dir, filename)

    # Start building the MDX content
    content = []

    # Frontmatter
    title = module_name.split(".")[-1].replace("_", " ").title()
    module_docstring = get_docstring(module)

    # Get icon from module info
    module_info = get_module_info_from_filename(f"{module_name.replace('.', '_')}.mdx")
    icon = module_info["icon"]

    # Generate better description
    description = generate_module_description(module_name, module_docstring)

    # Generate GitHub URL for source code
    github_url = f"https://github.com/mcp-use/mcp-use/blob/main/{module_name.replace('.', '/')}.py"

    frontmatter = {"title": title, "description": description, "icon": icon, "github": github_url}

    content.append("---")
    for key, value in frontmatter.items():
        content.append(f'{key}: "{value}"')
    content.append("---")
    content.append("")
    # GitHub source code callout
    content.append('<Callout type="info" title="Source Code">')
    content.append(
        f"View the source code for this module on GitHub: <a href='{github_url}'"
        f" target='_blank' rel='noopener noreferrer'>{github_url}</a>"
    )
    content.append("</Callout>")
    content.append("")
    # Module description
    if module_docstring:
        content.append(process_docstring(module_docstring))
        content.append("")

    # Get all members of the module
    members = inspect.getmembers(module)

    # Classes - only include classes defined in this module
    classes = [
        (name, obj)
        for name, obj in members
        if inspect.isclass(obj) and not name.startswith("_") and is_defined_in_module(obj, module_name)
    ]
    for _, cls in classes:
        content.append(generate_class_docs(cls, module_name))
        content.append("")

    # Functions - only include functions defined in this module
    functions = [
        (name, obj)
        for name, obj in members
        if inspect.isfunction(obj) and not name.startswith("_") and is_defined_in_module(obj, module_name)
    ]
    for _, func in functions:
        content.append(generate_function_docs(func, module_name))
        content.append("")

    # Write the file
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(content))

    print(f"Generated documentation for {module_name} -> {output_path}")


def find_python_modules(package_dir: str) -> list[str]:
    """Find all Python modules in a package directory, excluding __init__.py files."""
    modules = []
    package_path = Path(package_dir)

    if not package_path.exists():
        return modules

    # Find all submodules, excluding __init__.py files
    for py_file in package_path.rglob("*.py"):
        if py_file.name == "__init__.py":
            # Skip __init__.py files
            continue
        elif not py_file.name.startswith("__"):
            # This is a module
            rel_path = py_file.relative_to(package_path.parent)
            module_name = str(rel_path.with_suffix("")).replace("/", ".")
            if module_name not in modules:
                modules.append(module_name)

    return sorted(modules)


def get_module_info_from_filename(filename: str) -> dict[str, str]:
    """Extract module information from filename."""
    # Remove .mdx extension
    name = filename.replace(".mdx", "")

    # Convert snake_case to Title Case
    display_name = name.replace("_", " ").title()

    # Map specific modules to icons with better semantic mapping
    icon_map = {
        # Core modules
        "mcpagent": "bot",
        "mcpclient": "router",
        "client": "router",
        "server": "server",
        "agent": "bot",
        # Adapters and connectors
        "adapters": "plug-2",
        "connectors": "cable",
        "base": "box",
        "http": "globe",
        "websocket": "wifi",
        "stdio": "terminal",
        "sandbox": "lock",
        "streamable_http": "globe",
        "sse": "radio",
        # Authentication
        "auth": "key",
        "bearer": "shield",
        "oauth": "key",
        "oauth_callback": "key",
        # Middleware and processing
        "middleware": "layers",
        "middleware_logging": "logs",
        "middleware_metrics": "bar-chart",
        # Observability and monitoring
        "observability": "eye",
        "telemetry": "chart-line",
        "logging": "logs",
        "callbacks_manager": "phone-callback",
        "laminar": "chart-bar",
        "langfuse": "chart-line",
        "metrics": "bar-chart",
        "events": "calendar",
        # Configuration and management
        "config": "settings",
        "session": "session",
        "managers": "users",
        "server_manager": "server-cog",
        "task_managers": "command",
        # Tools and utilities
        "tools": "hammer",
        "base_tool": "hammer",
        "connect_server": "server-plus",
        "disconnect_server": "server-minus",
        "get_active_server": "server",
        "list_servers_tool": "list",
        "search_tools": "search",
        "utils": "tool",
        # CLI and interfaces
        "cli": "terminal",
        # Types and data structures
        "types": "type",
        # Prompts and templates
        "prompts": "volume-2",
        "templates": "file-template",
        "system_prompt_builder": "file-text",
        # Error handling
        "exceptions": "triangle-alert",
        "errors": "triangle-alert",
        "error_formatting": "triangle-alert",
        # Remote and cloud
        "remote": "cloud",
        "openmcp": "server",
    }

    icon = icon_map.get(name, "code")

    return {"module": name, "display_name": display_name, "icon": icon}


def organize_modules_by_path(files: list[str]) -> dict[str, dict[str, list[dict[str, str]]]]:
    """Organize modules by file path structure with nested groups."""
    packages = {}

    for filename in files:
        if filename.endswith(".mdx"):
            # Skip __init__.py files
            if filename == "__init__.mdx":
                continue

            module_info = get_module_info_from_filename(filename)

            # Extract module path from filename automatically
            module_path = filename.replace(".mdx", "")

            # Convert filename to module path automatically
            if module_path.startswith("mcp_use_"):
                # Remove mcp_use_ prefix and convert to module path
                remaining = module_path[8:]  # Remove 'mcp_use_'

                # Handle compound package names by mapping them back
                compound_mappings = {
                    "task_managers": "task_managers",
                    "error_formatting": "error_formatting",
                    "oauth_callback": "oauth_callback",
                    "callbacks_manager": "callbacks_manager",
                    "streamable_http": "streamable_http",
                    "langchain_adapter": "langchain_adapter",
                    "system_prompt_builder": "system_prompt_builder",
                    "server_manager": "server_manager",
                    "base_tool": "base_tool",
                    "connect_server": "connect_server",
                    "disconnect_server": "disconnect_server",
                    "get_active_server": "get_active_server",
                    "list_servers_tool": "list_servers_tool",
                    "search_tools": "search_tools",
                }

                # Check if this is a compound name we need to preserve
                module_path = "mcp_use."
                parts = remaining.split("_")

                # Reconstruct the path, preserving compound names
                i = 0
                while i < len(parts):
                    # Check for compound names starting at this position
                    compound_found = False
                    for compound, replacement in compound_mappings.items():
                        compound_parts = compound.split("_")
                        if i + len(compound_parts) <= len(parts):
                            if "_".join(parts[i : i + len(compound_parts)]) == compound:
                                module_path += replacement + "."
                                i += len(compound_parts)
                                compound_found = True
                                break

                    if not compound_found:
                        module_path += parts[i] + "."
                        i += 1

                # Remove trailing dot
                module_path = module_path.rstrip(".")
            else:
                # Handle other cases
                module_path = module_path.replace("_", ".")

            # Dynamically determine package and subpackage based on module path
            path_parts = module_path.split(".")

            if len(path_parts) == 1:
                # Root level module (e.g., 'mcp_use')
                package = "core"
                subpackage = "root"
            elif len(path_parts) == 2:
                # Top-level package (e.g., 'mcp_use.client') - these are root-level modules
                package = "core"
                subpackage = path_parts[1]  # Use the module name as subpackage
            elif len(path_parts) >= 3:
                # Subpackage (e.g., 'mcp_use.task_managers.base')
                # The package is the compound name (e.g., 'task_managers')
                package = path_parts[1]
                subpackage = path_parts[2]
            else:
                # Fallback
                package = "other"
                subpackage = "root"

            if package not in packages:
                packages[package] = {}

            if subpackage:
                if subpackage not in packages[package]:
                    packages[package][subpackage] = []
                packages[package][subpackage].append(module_info)
            else:
                if "root" not in packages[package]:
                    packages[package]["root"] = []
                packages[package]["root"].append(module_info)

    return packages


def get_package_display_info(package: str) -> dict[str, str]:
    """Get display information for a package."""
    # Common package icons
    package_icons = {
        "core": "package",
        "client": "router",
        "server": "server",
        "agent": "bot",
        "auth": "key",
        "middleware": "layers",
        "connectors": "cable",
        "adapters": "plug-2",
        "observability": "eye",
        "telemetry": "chart-line",
        "logging": "logs",
        "cli": "terminal",
        "utils": "tool",
        "config": "settings",
        "session": "database",
        "errors": "triangle-alert",
        "types": "type",
        "task_managers": "command",
        "managers": "users",
        "prompts": "volume-2",
        "remote": "cloud",
        "sandbox": "shield",
        "http": "globe",
        "stdio": "terminal",
        "websocket": "wifi",
        "bearer": "key",
        "oauth": "lock",
        "oauth_callback": "refresh-cw",
        "error_formatting": "alert-triangle",
        "exceptions": "alert-circle",
        "callbacks_manager": "users",
        "laminar": "layers",
        "langfuse": "chart-line",
        "base": "layers",
        "sse": "activity",
        "streamable_http": "globe",
        "events": "calendar",
        "other": "code",
    }

    # Use predefined icon if available, otherwise default to 'code'
    icon = package_icons.get(package, "code")

    # Convert package name to display name
    display_name = package.replace("_", " ").title()

    return {"name": display_name, "icon": icon}


def get_subpackage_display_info(subpackage: str) -> dict[str, str]:
    """Get display information for a subpackage."""
    # Common subpackage icons
    subpackage_icons = {
        "root": "globe",
        "managers": "users",
        "adapters": "plug-2",
        "observability": "eye",
        "prompts": "volume-2",
        "auth": "key",
        "connectors": "cable",
        "middleware": "layers",
        "task_managers": "tasks",
        "errors": "alert-triangle",
        "types": "type",
        "tools": "tool",
        "remote": "cloud",
        "sandbox": "shield",
        "http": "globe",
        "stdio": "terminal",
        "websocket": "wifi",
        "bearer": "key",
        "oauth": "lock",
        "oauth_callback": "refresh-cw",
        "error_formatting": "alert-triangle",
        "exceptions": "alert-circle",
        "callbacks_manager": "users",
        "laminar": "layers",
        "langfuse": "chart-line",
        "base": "layers",
        "sse": "activity",
        "streamable_http": "globe",
        "events": "calendar",
        "telemetry": "chart-line",
        "utils": "tool",
        "config": "settings",
        "session": "database",
        "logging": "logs",
        "cli": "terminal",
    }

    # Use predefined icon if available, otherwise default to 'code'
    icon = subpackage_icons.get(subpackage, "code")

    # Convert subpackage name to display name
    if subpackage == "root":
        display_name = "Overview"
    else:
        display_name = subpackage.replace("_", " ").title()

    return {"name": display_name, "icon": icon}


def generate_api_reference_groups(packages: dict[str, dict[str, list[dict[str, str]]]]) -> list[dict[str, Any]]:
    """Generate API reference groups from organized packages with nested structure."""
    groups = []

    # Process packages in alphabetical order for consistent organization
    for package in sorted(packages.keys()):
        if package in packages and packages[package]:
            package_info = get_package_display_info(package)

            # Check if this package has subpackages
            has_subpackages = any(key != "root" for key in packages[package].keys())

            if has_subpackages:
                # Create nested structure with subpackages
                subpackages = []

                # Add root items directly to subpackages list (no Overview section)
                if "root" in packages[package] and packages[package]["root"]:
                    root_modules = sorted(packages[package]["root"], key=lambda x: x["display_name"])
                    root_pages = [f"api-reference/{module['module']}" for module in root_modules]
                    subpackages.extend(root_pages)

                # Add other subpackages - only create subsections if they have more than 1 item
                for subpackage_name in sorted(packages[package].keys()):
                    if subpackage_name == "root":
                        continue

                    modules = packages[package][subpackage_name]

                    # Only create subsection if there's more than 1 module
                    if len(modules) > 1:
                        subpackage_info = get_subpackage_display_info(subpackage_name)
                        sorted_modules = sorted(modules, key=lambda x: x["display_name"])
                        pages = [f"api-reference/{module['module']}" for module in sorted_modules]

                        subpackages.append(
                            {"group": subpackage_info["name"], "icon": subpackage_info["icon"], "pages": pages}
                        )
                    else:
                        # Single module - add directly to root level
                        module = modules[0]
                        subpackages.append(f"api-reference/{module['module']}")

                group = {"group": package_info["name"], "icon": package_info["icon"], "pages": subpackages}
            else:
                # Simple structure without subpackages
                modules = sorted(packages[package]["root"], key=lambda x: x["display_name"])
                pages = [f"api-reference/{module['module']}" for module in modules]

                group = {"group": package_info["name"], "icon": package_info["icon"], "pages": pages}

            groups.append(group)

    return groups


def update_docs_json(docs_json_path: str, api_reference_dir: str) -> None:
    """Update docs.json with new API reference structure."""
    # Read existing docs.json
    with open(docs_json_path, encoding="utf-8") as f:
        docs_config = json.load(f)

    # Get all MDX files in api-reference directory
    api_ref_path = Path(api_reference_dir)
    if not api_ref_path.exists():
        print(f"API reference directory {api_reference_dir} does not exist")
        return

    mdx_files = [f.name for f in api_ref_path.glob("*.mdx")]

    # Organize modules by path
    packages = organize_modules_by_path(mdx_files)

    # Generate API reference groups
    api_groups = generate_api_reference_groups(packages)

    # Update the navigation structure
    for tab in docs_config["navigation"]["tabs"]:
        if tab["tab"] == "API Reference":
            tab["groups"] = api_groups
            break

    # Write updated docs.json
    with open(docs_json_path, "w", encoding="utf-8") as f:
        json.dump(docs_config, f, indent=2, ensure_ascii=False)

    print(f"Updated {docs_json_path} with {len(mdx_files)} API reference files")
    print(f"Organized into {len(api_groups)} groups")


def main():
    """Main function."""
    if len(sys.argv) < 2:
        print("Usage: python generate_docs.py <package_dir> [output_dir] [docs_json_path]")
        print("Example: python generate_docs.py ../mcp_use api-reference docs.json")
        sys.exit(1)

    package_dir = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "api-reference"
    docs_json_path = sys.argv[3] if len(sys.argv) > 3 else "docs.json"

    # Add parent directory to Python path to import the package
    parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, parent_dir)

    print("🔄 Generating API documentation...")

    # Step 1: Generate all API docs
    modules = find_python_modules(package_dir)
    print(f"Found {len(modules)} modules")

    # Generate docs for each module
    success_count = 0
    for module in modules:
        try:
            print(f"Generating docs for {module}...")
            generate_module_docs(module, output_dir)
            success_count += 1
        except Exception as e:
            print(f"Error generating docs for {module}: {e}")
            continue

    print(f"✅ Generated documentation for {success_count}/{len(modules)} modules")

    # Step 2: Update docs.json
    print("🔄 Updating docs.json...")

    if os.path.exists(docs_json_path):
        update_docs_json(docs_json_path, output_dir)
        print("✅ Updated docs.json with new API reference structure")
    else:
        print(f"⚠️  docs.json not found at {docs_json_path}, skipping update")

    print("🎉 API documentation generation complete!")
    print(f"📁 Files generated in: {output_dir}")
    print(f"📄 Navigation updated in: {docs_json_path}")


if __name__ == "__main__":
    main()
