"""Adapter for servers built on the official ``mcp`` 1.x low-level ``Server``.

That covers the low-level ``Server`` itself, the official ``FastMCP``
(``mcp.server.fastmcp``), mcp-use's ``MCPServer`` (a ``FastMCP`` subclass) and
community ``fastmcp`` 2.x/3.x, which all serve every connection through
``Server.run(read_stream, write_stream, ...)``.

Every transport (stdio, SSE, streamable HTTP stateful and stateless, in-memory)
calls ``run`` with the connection's message streams, so the adapter replaces
``run`` on the instance (never on the class, nothing global) and observes those
streams. One JSON-RPC request in and its response out make one event:

- it sees exactly what goes on the wire, including ``initialize`` (which the
  SDK answers inside ``ServerSession``, before any request handler), unknown
  methods, ``McpError`` responses and tool results with ``isError``;
- it does not depend on how or when handlers were registered (decorators,
  direct ``request_handlers`` writes, mcp-use re-wrapping them in ``run()``,
  tools added after ``instrument()``), so it records each request exactly once;
- the HTTP request (headers, path) comes from the message metadata the
  transport attaches, the client identity from this connection's ``initialize``;
- a request is queued once its response was handed to the transport. When the
  client gives up first (a stateless HTTP request whose client timed out or
  disconnected, stdio EOF, a session ``DELETE``), the response can still come
  later and is matched; a request still unanswered when ``run`` returns, whose
  response could not be written, or that the client cancelled
  (``notifications/cancelled``) is recorded without an outcome (the ingest edge
  reads that like the gateway's unresolved requests).
"""

from __future__ import annotations

import functools
import logging
import uuid
import weakref
from collections.abc import Mapping
from typing import Any

from . import _extract as ex
from ._guard import RECORDING
from ._recorder import Event, Recorder

logger = logging.getLogger("mcp_use_analytics")

MARK = "__mcp_use_analytics__"

# Connections holding an `initialize` event until their session id is known.
_deferred_states: weakref.WeakSet[_Connection] = weakref.WeakSet()


def release_deferred() -> None:
    """Send held ``initialize`` events now (``flush()`` calls this)."""
    try:
        states = list(_deferred_states)
    except RuntimeError:  # the set changed under us (another thread); the next flush gets them
        return
    for state in states:
        state.release()


class _Connection:
    """Per-``run()`` state: one client connection (or one stateless HTTP request)."""

    def __init__(self, recorder: Recorder, stateless: bool) -> None:
        self.recorder = recorder
        self.stateless = stateless
        self.session_id: str | None = None
        self.transport: str | None = None
        self.client: tuple[str | None, str | None] | None = None
        self.protocol_version: str | None = None
        self.pending: dict[Any, Event] = {}
        # Pending requests the client cancelled (`notifications/cancelled`).
        self.cancelled: set[Any] = set()
        self.deferred: list[Event] = []

    # -- inbound ------------------------------------------------------------

    def _learn_transport(self, request: Any) -> None:
        if request is None:
            if self.transport is None:
                self.transport = "stdio"
                self.session_id = uuid.uuid4().hex
            return
        query = getattr(request, "query_params", None)
        sse_session = ex.header(query, "session_id")
        if sse_session:
            self.transport = "sse"
            self.session_id = self.session_id or sse_session
        else:
            self.transport = "streamable-http"
            session_id = ex.header(getattr(request, "headers", None), "mcp-session-id")
            if session_id and self.session_id is None:
                self.session_id = session_id
                self.release()

    def inbound(self, item: Any) -> None:
        if isinstance(item, BaseException):
            return
        message = getattr(item, "message", None)
        root = getattr(message, "root", message)
        request = getattr(getattr(item, "metadata", None), "request_context", None)
        self._learn_transport(request)
        method = getattr(root, "method", None)
        request_id = getattr(root, "id", None)
        params = ex.as_mapping(getattr(root, "params", None))
        if method == "notifications/cancelled" and params is not None:
            cancelled = params.get("requestId")
            if cancelled is not None and cancelled in self.pending:
                self.cancelled.add(cancelled)
            return
        if not isinstance(method, str) or request_id is None:
            return  # a notification, or the client's answer to a server request
        if method == "initialize" and params is not None:
            self.client = ex.client_from_info(params.get("clientInfo")) or self.client
            self.protocol_version = ex.protocol_version(params.get("protocolVersion")) or self.protocol_version
        event = self.recorder.begin(
            method,
            request_id,
            params,
            http_request=request,
            session_id=self.session_id,
            transport=self.transport,
            stateless=self.stateless if self.transport == "streamable-http" else None,
            protocol_version=self.protocol_version,
            client=self.client,
        )
        if event is not None:
            self.pending[request_id] = event

    # -- outbound -----------------------------------------------------------

    def outbound(self, item: Any) -> tuple[Event, bool] | None:
        """Complete the request a response answers: ``(event, held)``; :meth:`written` queues it after the write."""
        message = getattr(item, "message", None)
        root = getattr(message, "root", message)
        request_id = getattr(root, "id", None)
        if request_id is None or getattr(root, "method", None) is not None:
            return None  # a notification, or a server-to-client request
        event = self.pending.pop(request_id, None)
        if event is None:
            return None
        if request_id in self.cancelled:
            # The client gave up on it; the SDK's "Request cancelled" error
            # (code 0) is a courtesy, not an outcome (mcp 2.x sends none).
            self.cancelled.discard(request_id)
            self.recorder.abandon(event)
            return None
        error = getattr(root, "error", None)
        if error is not None:
            self.recorder.complete(
                event,
                failed=True,
                error_code=getattr(error, "code", None),
                error_message=getattr(error, "message", None),
                error_data=getattr(error, "data", None),
                enqueue=False,
            )
        else:
            result = getattr(root, "result", None)
            if event.method == "initialize" and isinstance(result, Mapping):
                self.protocol_version = ex.protocol_version(result.get("protocolVersion")) or self.protocol_version
            self.recorder.complete(event, result=result, enqueue=False)
        held = not self._enqueue_now(event)
        if held:
            # Registered before the write: the client's next message, which
            # carries the session id and releases it, can only follow the write.
            self.deferred.append(event)
            _deferred_states.add(self)
        return event, held

    def written(self, event: Event, held: bool, delivered: bool) -> None:
        """Queue a completed request once its response was written, or as unanswered when the write failed.

        A held ``initialize`` is queued by :meth:`release` instead, unless its write failed first.
        """
        if delivered:
            if not held:
                self.recorder.queue(event)
            return
        if held:
            try:
                self.deferred.remove(event)
            except ValueError:  # flush() on another thread released it already
                return
        self.recorder.abandon(event)

    def _enqueue_now(self, event: Event) -> bool:
        # A stateful streamable HTTP session gets its id in the initialize
        # *response* headers; hold that event until the client's next message
        # (notifications/initialized) carries the id.
        return not (
            event.method == "initialize"
            and self.transport == "streamable-http"
            and not self.stateless
            and self.session_id is None
        )

    def release(self) -> None:
        # list.pop is atomic, so flush() on another thread never sends an event twice.
        while self.deferred:
            try:
                event = self.deferred.pop()
            except IndexError:
                return
            event.session_id = event.session_id or ex.clip(self.session_id, ex.LIMITS["session_id"])
            self.recorder.queue(event)

    def close(self) -> None:
        """The read side ended (EOF, client gone). Responses still in flight keep being matched."""
        self.release()

    def finish(self) -> None:
        """``run`` returned: requests that never got a response are recorded without an outcome."""
        while self.pending:
            try:
                _, event = self.pending.popitem()
            except KeyError:
                break
            self.recorder.abandon(event)
        self.release()


def _proxies() -> tuple[type, type]:
    """Stream proxy classes, built lazily so importing this package never needs anyio."""
    global _PROXY_CLASSES
    if _PROXY_CLASSES is not None:
        return _PROXY_CLASSES
    import anyio
    from anyio.abc import ObjectReceiveStream, ObjectSendStream

    end_of_stream = (anyio.EndOfStream, anyio.ClosedResourceError, anyio.BrokenResourceError)

    class ReadProxy(ObjectReceiveStream):  # type: ignore[type-arg]
        def __init__(self, inner: Any, connection: _Connection) -> None:
            self._inner = inner
            self._connection = connection

        async def receive(self) -> Any:
            try:
                item = await self._inner.receive()
            except end_of_stream:
                self._connection.close()
                raise
            try:
                self._connection.inbound(item)
            except Exception:
                logger.debug("mcp-use-analytics: could not read an inbound message", exc_info=True)
            return item

        async def aclose(self) -> None:
            self._connection.close()
            await self._inner.aclose()

        def __getattr__(self, name: str) -> Any:
            if name in _OWN_ATTRIBUTES:  # not set yet: never recurse
                raise AttributeError(name)
            return getattr(self._inner, name)

    class WriteProxy(ObjectSendStream):  # type: ignore[type-arg]
        def __init__(self, inner: Any, connection: _Connection) -> None:
            self._inner = inner
            self._connection = connection

        async def send(self, item: Any) -> None:
            answered = None
            try:
                answered = self._connection.outbound(item)
            except Exception:
                logger.debug("mcp-use-analytics: could not read an outbound message", exc_info=True)
            delivered = False
            try:
                await self._inner.send(item)
                delivered = True
            finally:
                if answered is not None:
                    try:
                        self._connection.written(*answered, delivered)
                    except Exception:
                        logger.debug("mcp-use-analytics: could not record a response", exc_info=True)

        async def aclose(self) -> None:
            await self._inner.aclose()

        def __getattr__(self, name: str) -> Any:
            if name in _OWN_ATTRIBUTES:  # not set yet: never recurse
                raise AttributeError(name)
            return getattr(self._inner, name)

    _PROXY_CLASSES = (ReadProxy, WriteProxy)
    return _PROXY_CLASSES


_PROXY_CLASSES: tuple[type, type] | None = None
_OWN_ATTRIBUTES = frozenset({"_inner", "_connection"})


def _wrap_streams(
    recorder: Recorder, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> tuple[tuple[Any, ...], dict[str, Any], _Connection | None]:
    read_proxy, write_proxy = _proxies()
    stateless = bool(kwargs.get("stateless", args[4] if len(args) > 4 else False))
    connection = _Connection(recorder, stateless)
    args_list = list(args)
    if "read_stream" in kwargs:
        kwargs["read_stream"] = read_proxy(kwargs["read_stream"], connection)
    elif args_list:
        args_list[0] = read_proxy(args_list[0], connection)
    else:
        return args, kwargs, None
    if "write_stream" in kwargs:
        kwargs["write_stream"] = write_proxy(kwargs["write_stream"], connection)
    elif len(args_list) > 1:
        args_list[1] = write_proxy(args_list[1], connection)
    return tuple(args_list), kwargs, connection


def install(lowlevel: Any, recorder: Recorder) -> bool:
    """Instrument one low-level server instance; ``False`` if it already was."""
    if getattr(lowlevel, MARK, None) is not None:
        return False
    original_run = lowlevel.run

    @functools.wraps(original_run)
    async def run(*args: Any, **kwargs: Any) -> Any:
        if RECORDING.get():
            # Served from inside another instrumented request (an in-process
            # proxy or mounted server): the outer server records it.
            return await original_run(*args, **kwargs)
        try:
            args, kwargs, connection = _wrap_streams(recorder, args, kwargs)
        except Exception:
            logger.debug("mcp-use-analytics: could not attach to a connection", exc_info=True)
            return await original_run(*args, **kwargs)
        token = RECORDING.set(True)
        try:
            return await original_run(*args, **kwargs)
        finally:
            RECORDING.reset(token)
            if connection is not None:
                try:
                    connection.finish()
                except Exception:
                    logger.debug("mcp-use-analytics: could not record unanswered requests", exc_info=True)

    lowlevel.run = run
    setattr(lowlevel, MARK, recorder)
    return True
