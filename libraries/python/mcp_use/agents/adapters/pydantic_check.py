from typing import Annotated, Any, Union, get_args, get_origin

from langchain_core.runnables import RunnableConfig


def field_annotation(schema_cls: type, name: str) -> Any:
    """Return the typing annotation for a field, Pydantic v2 or v1."""
    # v2
    fields_v2 = getattr(schema_cls, "model_fields", None)
    if fields_v2 and name in fields_v2:
        return fields_v2[name].annotation
    # v1
    fields_v1 = getattr(schema_cls, "__fields__", None)
    if fields_v1 and name in fields_v1:
        # outer_type_ includes Optional[...] etc; good for our use
        return fields_v1[name].outer_type_
    raise AttributeError(f"Field '{name}' not found on {schema_cls!r}")


def is_runnable_config_type(tp: Any) -> bool:
    """Recursively test whether a typing annotation is RunnableConfig."""
    if tp is None:
        return False
    origin = get_origin(tp)

    # Annotated[X, ...] -> check X
    if origin is Annotated:
        return is_runnable_config_type(get_args(tp)[0])

    # Optional[X] / Union[X, Y, ...]
    if origin is Union:
        return any(is_runnable_config_type(arg) for arg in get_args(tp))
    if hasattr(tp, "__name__") and tp.__name__ in ["RunnableConfig", "DynamicModel"]:
        return True

    # Direct match
    return tp is RunnableConfig


def field_is_runnable_config(args_schema: type, field_name: str) -> bool:
    """Return True if args_schema.<field_name> is annotated as RunnableConfig (or Optional/Annotated of it)."""
    ann = field_annotation(args_schema, field_name)
    value = is_runnable_config_type(ann)
    return value


def schema_has_runnable_config(args_schema: type) -> tuple[bool, str | None]:
    """Scan all fields; return (found?, field_name)."""
    # v2 names
    fields = getattr(args_schema, "model_fields", None)
    if fields is None:
        fields = getattr(args_schema, "__fields__", None) or {}
    for name in fields:
        if field_is_runnable_config(args_schema, name):
            return True, name
    return False, None
