from __future__ import annotations

from collections.abc import Sequence
from dataclasses import MISSING, fields, is_dataclass
from typing import TYPE_CHECKING, Any, Literal, cast

from mcp.server.elicitation import ElicitationResult, ElicitSchemaModelT
from mcp.server.fastmcp import Context as FastMCPContext
from mcp.types import CreateMessageResult, ListRootsResult, ModelPreferences, Root, SamplingMessage, TextContent
from pydantic import BaseModel, Field, create_model
from starlette.requests import Request

from mcp_use.telemetry.telemetry import Telemetry

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer

_telemetry = Telemetry()

# MCP log levels ordered by severity (lowest to highest)
_LOG_LEVEL_ORDER = {
    "debug": 0,
    "info": 1,
    "notice": 2,
    "warning": 3,
    "error": 4,
    "critical": 5,
    "alert": 6,
    "emergency": 7,
}


class Context(FastMCPContext):
    async def log(
        self,
        level: Literal["debug", "info", "warning", "error"],
        message: str,
        *,
        logger_name: str | None = None,
    ) -> None:
        """Send a log message to the client, respecting the client's log level.

        Messages below the level set by the client via logging/setLevel are suppressed.
        """
        server: MCPServer | None = getattr(self, "_fastmcp", None)
        if server is not None:
            client_level = getattr(server, "_client_log_level", "debug")
            if _LOG_LEVEL_ORDER.get(level, 0) < _LOG_LEVEL_ORDER.get(client_level, 0):
                return

        await self.request_context.session.send_log_message(
            level=level,
            data=message,
            logger=logger_name,
            related_request_id=self.request_id,
        )

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

    async def list_roots(self) -> list[Root]:
        """Request the list of roots from the client.

        Roots represent directories or files that the client has access to
        and wants to make available to the server.

        Returns:
            A list of Root objects, each with a 'uri' (file:// URI) and
            optional 'name' field.

        Example:
            ```python
            @mcp.tool()
            async def analyze_workspace(ctx: Context) -> str:
                roots = await ctx.list_roots()
                if not roots:
                    return "No roots provided by client"
                return f"Client has {len(roots)} root(s): {[str(r.uri) for r in roots]}"
            ```
        """
        _telemetry.track_server_context(context_type="list_roots")
        result: ListRootsResult = await self.session.list_roots()
        return result.roots

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
