from __future__ import annotations

import json
import time
from typing import Any

from mcp_use.server.middleware.middleware import CallNext, Middleware, ServerMiddlewareContext
from mcp_use.telemetry.telemetry import Telemetry

_telemetry = Telemetry()


class TelemetryMiddleware(Middleware):
    async def on_call_tool(self, context: ServerMiddlewareContext[Any], call_next: CallNext[Any, Any]) -> Any:
        start_time = time.time()
        success = True
        error_type: str | None = None

        try:
            return await call_next(context)
        except Exception as exc:
            success = False
            error_type = type(exc).__name__
            raise
        finally:
            tool_name = context.message.name
            arguments = context.message.arguments or {}
            serialized_arguments = json.dumps(arguments)
            _telemetry.track_server_tool_call(
                tool_name=tool_name,
                length_input_argument=len(serialized_arguments),
                success=success,
                execution_time_ms=int((time.time() - start_time) * 1000),
                error_type=error_type,
            )

    async def on_read_resource(self, context: ServerMiddlewareContext[Any], call_next: CallNext[Any, Any]) -> Any:
        success = True
        error_type: str | None = None

        try:
            return await call_next(context)
        except Exception as exc:
            success = False
            error_type = type(exc).__name__
            raise
        finally:
            _telemetry.track_server_resource_call(
                name=str(context.message.uri),
                description=None,
                contents=[],
                success=success,
                error_type=error_type,
            )

    async def on_get_prompt(self, context: ServerMiddlewareContext[Any], call_next: CallNext[Any, Any]) -> Any:
        success = True
        error_type: str | None = None

        try:
            return await call_next(context)
        except Exception as exc:
            success = False
            error_type = type(exc).__name__
            raise
        finally:
            _telemetry.track_server_prompt_call(
                name=context.message.name,
                description=None,
                success=success,
                error_type=error_type,
            )
