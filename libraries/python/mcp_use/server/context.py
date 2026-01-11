from __future__ import annotations

from collections.abc import Sequence
from dataclasses import MISSING, fields, is_dataclass
from typing import Any, cast

from mcp.server.elicitation import ElicitationResult, ElicitSchemaModelT
from mcp.server.fastmcp import Context as FastMCPContext
from mcp.types import CreateMessageResult, ModelPreferences, SamplingMessage, TextContent
from pydantic import BaseModel, Field, create_model
from starlette.requests import Request

from mcp_use.telemetry.telemetry import Telemetry

_telemetry = Telemetry()


class Context(FastMCPContext):
    async def sample(
        self,
        messages: str | SamplingMessage | Sequence[SamplingMessage | str],
        *,
        max_tokens: int = 512,
        system_prompt: str | None = None,
        include_context: bool | None = None,
        temperature: float | None = None,
        stop_sequences: Sequence[str] | None = None,
        metadata: dict[str, Any] | None = None,
        model_preferences: ModelPreferences | None = None,
        raw: bool = False,
    ) -> CreateMessageResult:
        """Request a client-side LLM sampling invocation.

        Args:
            messages: The sampling prompt(s). Accepts a simple string, a single
                ``SamplingMessage`` or a sequence mixing strings and sampling
                messages for multi-turn prompts.
            max_tokens: Maximum number of tokens to request from the client LLM.
            system_prompt: Optional system instructions to prepend.
            include_context: Whether to ask the client to include MCP context.
            temperature: Optional sampling temperature.
            stop_sequences: Optional stop sequences to pass to the client LLM.
            metadata: Optional provider-specific metadata.
            model_preferences: Optional hint about the desired model.
            raw: When ``True`` returns the full ``CreateMessageResult`` instead of
                just the ``TextContent`` convenience wrapper.
        """
        _telemetry.track_server_context(context_type="sample")

        result = await self.session.create_message(
            messages=messages,
            max_tokens=max_tokens,
            system_prompt=system_prompt,
            include_context=include_context,
            temperature=temperature,
            stop_sequences=list(stop_sequences) if stop_sequences is not None else None,
            metadata=metadata,
            model_preferences=model_preferences,
            related_request_id=self.request_context.request_id,
        )
        return result

    async def send_tool_list_changed(self) -> None:
        """Notify the client that the tool list changed."""
        _telemetry.track_server_context(context_type="notification", notification_type="tools/list_changed")
        await self.session.send_tool_list_changed()

    async def send_resource_list_changed(self) -> None:
        """Notify the client that the resource list changed."""
        _telemetry.track_server_context(context_type="notification", notification_type="resources/list_changed")
        await self.session.send_resource_list_changed()

    async def send_prompt_list_changed(self) -> None:
        """Notify the client that the prompt list changed."""
        _telemetry.track_server_context(context_type="notification", notification_type="prompts/list_changed")
        await self.session.send_prompt_list_changed()

    def get_http_request(self) -> Request | None:
        """Return the underlying Starlette Request when running over HTTP transports."""
        request = getattr(self.request_context, "request", None)
        if request is None:
            return None
        return cast(Request, request)

    async def elicit(
        self,
        message: str,
        schema: type[ElicitSchemaModelT] | type[Any],
    ) -> ElicitationResult[ElicitSchemaModelT]:
        """Support both Pydantic models and dataclasses for elicitation schemas."""
        _telemetry.track_server_context(context_type="elicit")

        schema_model, dataclass_schema = self._coerce_schema(schema)
        result = await super().elicit(message=message, schema=schema_model)

        if dataclass_schema is not None and result.action == "accept":
            result.data = dataclass_schema(**result.data.model_dump())

        return result

    @staticmethod
    def _text_message(text: str) -> SamplingMessage:
        return SamplingMessage(
            role="user",
            content=TextContent(type="text", text=text),
        )

    def _coerce_schema(
        self,
        schema: type[ElicitSchemaModelT] | type[Any],
    ) -> tuple[type[ElicitSchemaModelT], type[Any] | None]:
        if isinstance(schema, type) and is_dataclass(schema):
            dataclass_schema = schema
            model = self._dataclass_to_model(schema)
            return model, dataclass_schema
        return schema, None

    @staticmethod
    def _dataclass_to_model(schema: type[Any]) -> type[BaseModel]:
        field_definitions: dict[str, tuple[type[Any], Any]] = {}
        for field in fields(schema):
            default: Any
            if field.default is not MISSING:
                default = field.default
            elif field.default_factory is not MISSING:
                default = Field(default_factory=field.default_factory)
            else:
                default = ...
            field_definitions[field.name] = (cast(type[Any], field.type), default)

        model_name = f"{schema.__name__}ElicitationModel"
        return create_model(model_name, **field_definitions)  # type: ignore[arg-type]
