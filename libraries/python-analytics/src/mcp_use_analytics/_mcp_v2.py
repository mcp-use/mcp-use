"""Adapter for servers built on the official ``mcp`` 2.x low-level ``Server``.

That covers the low-level ``Server``, ``mcp.server.mcpserver.MCPServer`` and
community ``fastmcp`` 4.x. ``mcp`` 2.x has a first-class seam for this:
``Server.middleware``, a list of ``(ctx, call_next)`` callables that wraps
every inbound message on every transport, including ``initialize``,
``server/discover``, unknown methods and params validation. The adapter puts
its middleware first (outermost), so it observes the final result or the
``MCPError`` the client receives after every other middleware has run. A
request cancelled before it produced either (the client cancelled it or went
away, or the server shut down) is recorded without an outcome.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from . import _extract as ex
from ._guard import RECORDING
from ._recorder import Event, Recorder

logger = logging.getLogger("mcp_use_analytics")

MARK = "__mcp_use_analytics__"
_STATE_KEY = "mcp_use_analytics.session_id"
# JSON-RPC: the modern (2026-07-28) HTTP entry answers unexpected handler
# exceptions with INTERNAL_ERROR; the handshake-era dispatcher keeps code 0.
_INTERNAL_ERROR = -32603
_INVALID_PARAMS = -32602


_process_session: str | None = None


def _process_session_id() -> str:
    global _process_session
    if _process_session is None:
        _process_session = uuid.uuid4().hex
    return _process_session


def _forget_process_session() -> None:
    global _process_session
    _process_session = None


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_forget_process_session)


def _is_modern(protocol_version: str | None) -> bool:
    if not protocol_version:
        return False
    year = protocol_version[:4]
    return year.isdigit() and int(year) >= 2026


class AnalyticsMiddleware:
    """``ServerMiddleware`` that records one event per inbound request."""

    def __init__(self, recorder: Recorder, server: Any) -> None:
        self.recorder = recorder
        self.server = server

    async def __call__(self, ctx: Any, call_next: Any) -> Any:
        if getattr(ctx, "request_id", None) is None or RECORDING.get():
            return await call_next(ctx)
        try:
            event = self._begin(ctx)
        except Exception:
            logger.debug("mcp-use-analytics: could not start recording", exc_info=True)
            event = None
        if event is None:
            return await call_next(ctx)
        token = RECORDING.set(True)
        try:
            result = await call_next(ctx)
        except BaseException as error:
            self._fail(event, error)
            raise
        finally:
            RECORDING.reset(token)
        self.recorder.complete(event, result=result)
        return result

    def _begin(self, ctx: Any) -> Event | None:
        session = getattr(ctx, "session", None)
        connection = getattr(session, "_connection", None)
        request = getattr(ctx, "request", None)
        protocol_version = getattr(ctx, "protocol_version", None)
        params = ex.as_mapping(getattr(ctx, "params", None))
        session_id = getattr(connection, "session_id", None)
        if request is not None:
            query_session = ex.header(getattr(request, "query_params", None), "session_id")
            transport = "sse" if query_session else "streamable-http"
            session_id = session_id or query_session or ex.header(getattr(request, "headers", None), "mcp-session-id")
            # Stateful sessions carry an id on every request (initialize included,
            # via the connection); a legacy request without one is stateless.
            stateless = _is_modern(protocol_version) or self._stateless_http() or not session_id
        else:
            transport, stateless = "stdio", None
            if _is_modern(protocol_version):
                # 2026-07-28 builds a connection per request; a stdio process
                # serves one client, so the process is the session.
                session_id = session_id or _process_session_id()
            else:
                session_id = session_id or self._connection_session_id(connection)
        client_params = getattr(connection, "client_params", None)
        client = ex.client_from_info(
            getattr(client_params, "client_info", None) or getattr(client_params, "clientInfo", None)
        )
        return self.recorder.begin(
            ctx.method,
            ctx.request_id,
            params,
            http_request=request,
            session_id=session_id,
            transport=transport,
            stateless=stateless if transport == "streamable-http" else None,
            protocol_version=protocol_version,
            client=client,
        )

    def _stateless_http(self) -> bool:
        manager = getattr(self.server, "_session_manager", None)
        return getattr(manager, "stateless", False) is True

    @staticmethod
    def _connection_session_id(connection: Any) -> str | None:
        # stdio and in-process connections have no transport session; the
        # connection's own scratch state carries one id for its lifetime.
        state = getattr(connection, "state", None)
        if not isinstance(state, dict):
            return None
        session_id = state.get(_STATE_KEY)
        if session_id is None:
            session_id = state[_STATE_KEY] = uuid.uuid4().hex
        return session_id

    def _fail(self, event: Event, error: BaseException) -> None:
        details = getattr(error, "error", None)
        code = getattr(details, "code", None)
        if isinstance(code, int) and isinstance(getattr(details, "message", None), str):  # MCPError
            self.recorder.complete(
                event,
                failed=True,
                error_code=code,
                error_message=getattr(details, "message", None),
                error_data=getattr(details, "data", None),
            )
        elif type(error).__name__ == "ValidationError":
            self.recorder.complete(
                event, failed=True, error_code=_INVALID_PARAMS, error_message="Invalid request parameters"
            )
        elif not isinstance(error, Exception):
            # Cancellation (the client cancelled or went away, shutdown): no
            # response reached the client, so there is no outcome to report,
            # the same as an unanswered request on the mcp 1.x adapter.
            self.recorder.abandon(event)
        else:
            code = _INTERNAL_ERROR if _is_modern(event.protocol_version) else 0
            self.recorder.complete(event, failed=True, error_code=code, error_message=str(error))


def install(lowlevel: Any, recorder: Recorder) -> bool:
    """Instrument one low-level server instance; ``False`` if it already was."""
    if getattr(lowlevel, MARK, None) is not None:
        return False
    middleware = lowlevel.middleware
    if any(isinstance(item, AnalyticsMiddleware) for item in middleware):
        return False
    middleware.insert(0, AnalyticsMiddleware(recorder, lowlevel))
    setattr(lowlevel, MARK, recorder)
    return True


def is_v2_server(obj: Any) -> bool:
    return isinstance(getattr(obj, "middleware", None), list) and callable(getattr(obj, "add_request_handler", None))
