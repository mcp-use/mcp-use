"""Turning one JSON-RPC exchange into one ``manufact.sdk.v1`` event.

Adapters call :meth:`Recorder.begin` when a request arrives and
:meth:`Recorder.complete` when its response is known, or :meth:`Recorder.abandon`
when the connection ended before any response was written. These only read
fields off objects that already exist and append to the channel's queue;
payload redaction, sizes and JSON encoding happen later, on the delivery
thread, in :meth:`Event.prepare`.
"""

from __future__ import annotations

import logging
import math
import os
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from . import _extract as ex
from ._actor import bearer_token, display_claim, sha256_hex, token_display_metadata, token_identity_hash
from ._encode import dumps, json_size
from ._redact import bound_payload, redact_payload
from ._transport import SCHEMA, Channel, RemoteConfig
from ._types import ConversationIdHook, IdentifyHook, PayloadContext, RedactHook, RequestInfo
from ._version import RUNTIME, SDK_NAME, __version__

logger = logging.getLogger("mcp_use_analytics")


def uuid7() -> str:
    """A time-ordered UUIDv7 string (the event id, reused on every retry)."""
    ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (
        (ms & ((1 << 48) - 1)) << 80 | 0x7 << 76 | (rand >> 62 & 0xFFF) << 64 | 0b10 << 62 | (rand & ((1 << 62) - 1))
    )
    return str(uuid.UUID(int=value))


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _identity_id(value: Any) -> str | None:
    """An ``identify`` hook's ``id`` as the TypeScript SDK reads it: a non-empty string or a number."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return str(int(value)) if value.is_integer() and abs(value) < 1e21 else repr(value)
    if isinstance(value, str):
        return value.strip() or None
    return None


@dataclass
class Options:
    """Per-``instrument()`` behaviour (see :func:`mcp_use_analytics.instrument`)."""

    capture_payloads: bool | None = None
    redact: RedactHook | None = None
    identify: IdentifyHook | None = None
    conversation_id: ConversationIdHook | str | None = None
    debug: bool = False


class Event:
    """One recorded request. Built on the request path, encoded on the delivery thread."""

    __slots__ = (
        "recorder",
        "id",
        "start",
        "perf",
        "duration_ms",
        "method",
        "request_id",
        "target",
        "params",
        "outcome",
        "error_code",
        "error_message",
        "session_id",
        "conversation_id",
        "client",
        "client_info",
        "protocol_version",
        "transport",
        "stateless",
        "http",
        "token_hash",
        "actor_name",
        "actor_email",
        "openai",
        "trace_id",
        "request_size",
        "response",
    )

    def __init__(self, recorder: Recorder, method: str, request_id: Any, params: Mapping[str, Any] | None) -> None:
        self.recorder = recorder
        self.id = uuid7()
        self.start = time.time()
        self.perf = time.perf_counter()
        self.duration_ms: float | None = None
        self.method = method
        self.request_id = request_id
        self.params = params
        self.target = ex.target_of(method, params)
        # "success" | "tool_error" | "error"; None when no response was written.
        self.outcome: str | None = "success"
        self.error_code: int | None = None
        self.error_message: str | None = None
        self.session_id: str | None = None
        self.conversation_id: str | None = None
        self.client: tuple[str | None, str | None] | None = None
        self.client_info: Any = None
        self.protocol_version: str | None = None
        self.transport: str | None = None
        self.stateless: bool | None = None
        self.http: dict[str, str] | None = None
        self.token_hash: str | None = None
        self.actor_name: str | None = None
        self.actor_email: str | None = None
        self.openai: dict[str, str] | None = None
        self.trace_id: str | None = None
        self.request_size: int | None = None
        self.response: dict[str, Any] | None = None

    def prepare(self, config: RemoteConfig) -> tuple[bytes, bytes] | None:
        return self.recorder.encode(self, config)


class Recorder:
    """Records the requests of one instrumented server into a shared :class:`Channel`."""

    def __init__(
        self,
        channel: Channel,
        options: Options,
        *,
        framework: str,
        framework_version: str | None,
        server_info: Mapping[str, Any] | None,
    ) -> None:
        self.channel = channel
        self.options = options
        self.sdk = {
            "name": SDK_NAME,
            "version": __version__,
            "language": "python",
            "framework": framework,
            "framework_version": framework_version,
            "runtime": RUNTIME,
        }
        self.server_info: Mapping[str, Any] | None = server_info
        self._envelope: tuple[Mapping[str, Any] | None, bytes] | None = None

    # -- request path -------------------------------------------------------

    def begin(
        self,
        method: str,
        request_id: Any,
        params: Mapping[str, Any] | None,
        *,
        http_request: Any = None,
        session_id: str | None = None,
        transport: str | None = None,
        stateless: bool | None = None,
        protocol_version: str | None = None,
        client: tuple[str | None, str | None] | None = None,
    ) -> Event | None:
        """Start recording a request; ``None`` when it must not be recorded.

        Requests that went through the Manufact gateway (``X-Gateway-Request-Id``)
        are skipped: the gateway already recorded them.
        """
        try:
            http = ex.http_of(http_request)
            headers = http[1] if http else None
            if ex.header(headers, ex.GATEWAY_REQUEST_HEADER) is not None:
                return None
            event = Event(self, method, request_id, params)
            meta = ex.meta_of(params)
            event.session_id = ex.clip(session_id, ex.LIMITS["session_id"])
            event.transport = transport
            event.stateless = stateless
            event.protocol_version = ex.protocol_version(ex.header(headers, "mcp-protocol-version") or protocol_version)
            event.client = ex.client_from_info({"name": client[0], "version": client[1]}) if client else None
            event.client = event.client or ex.client_from_meta(meta)
            if method == "initialize" and params is not None:
                event.client_info = params.get("clientInfo")
                event.client = ex.client_from_info(event.client_info) or event.client
                event.protocol_version = ex.protocol_version(params.get("protocolVersion")) or event.protocol_version
            if http is not None:
                event.http = http[0]
                length = ex.header(headers, "content-length")
                if length and length.isdigit():
                    event.request_size = int(length)
            event.openai = ex.openai_of(meta, headers)
            event.trace_id = ex.trace_id_of(meta, headers)
            self._identify(event, headers)
            return event
        except Exception:
            logger.debug("mcp-use-analytics: could not start recording %s", method, exc_info=True)
            return None

    def _request_info(self, event: Event, headers: Any, token: str | None) -> RequestInfo:
        client = event.client or (None, None)
        return RequestInfo(
            method=event.method,
            target=event.target,
            params=event.params,
            headers=ex.headers_dict(headers),
            session_id=event.session_id,
            client_name=client[0],
            client_version=client[1],
            access_token=token,
        )

    def _identify(self, event: Event, headers: Any) -> None:
        token = bearer_token(ex.header(headers, "authorization"))
        options = self.options
        info = None
        if options.identify is not None or callable(options.conversation_id):
            info = self._request_info(event, headers, token)
        if callable(options.conversation_id) and info is not None:
            try:
                event.conversation_id = ex.clip(options.conversation_id(info), ex.LIMITS["conversation_id"])
            except Exception:
                logger.debug("mcp-use-analytics: conversation_id hook failed", exc_info=True)
        elif isinstance(options.conversation_id, str):
            event.conversation_id = ex.clip(options.conversation_id, ex.LIMITS["conversation_id"])
        identity: Any = None
        if options.identify is not None and info is not None:
            try:
                identity = options.identify(info)
            except Exception:
                logger.debug("mcp-use-analytics: identify hook failed", exc_info=True)
        # Same rules as the TypeScript SDK: the hook's `id` (hashed) replaces the
        # Bearer token hash, and its `name`/`email` replace the token's display
        # claims, each on its own; `None` (or a failing hook) keeps the defaults.
        if not isinstance(identity, Mapping):
            identity = {}
        # Kept whatever the dashboard setting is now: encode() drops them unless
        # "identify actors" is on by then, and it may be turned on in between.
        name = email = None
        if token is not None:
            name, email = token_display_metadata(token)
        identity_id = _identity_id(identity.get("id"))
        if identity_id is not None:
            event.token_hash = sha256_hex(identity_id)
        elif token is not None:
            event.token_hash = token_identity_hash(token)
        event.actor_name = display_claim(identity.get("name"), 256) or name
        event.actor_email = display_claim(identity.get("email"), 320) or email

    def complete(
        self,
        event: Event | None,
        *,
        result: Any = None,
        error_code: int | None = None,
        error_message: str | None = None,
        error_data: Any = None,
        failed: bool = False,
        enqueue: bool = True,
    ) -> None:
        """Finish a request with its JSON-RPC ``result``, or its error when ``failed``.

        With ``enqueue=False`` the event is completed but not queued yet; the
        adapter queues it later (``initialize`` waiting for its session id).
        """
        if event is None:
            return
        try:
            event.duration_ms = round(max(0.0, (time.perf_counter() - event.perf) * 1000), 3)
            if failed:
                event.outcome = "error"
                event.error_code = (
                    error_code if isinstance(error_code, int) and not isinstance(error_code, bool) else None
                )
                event.error_message = ex.error_message(error_message)
                error: dict[str, Any] = {"code": event.error_code, "message": error_message or ""}
                if error_data is not None:
                    error["data"] = error_data
                event.response = {"jsonrpc": "2.0", "id": event.request_id, "error": error}
            else:
                result = ex.dump_model(result)
                if ex.is_error_result(result):
                    event.outcome = "tool_error"
                    event.error_message = ex.tool_error_text(result)
                if event.method == "initialize" and isinstance(result, Mapping):
                    self._learn_server_info(result.get("serverInfo"))
                event.response = {"jsonrpc": "2.0", "id": event.request_id, "result": result}
            if enqueue:
                self.queue(event)
        except Exception:
            logger.debug("mcp-use-analytics: could not record %s", event.method, exc_info=True)

    def abandon(self, event: Event | None) -> None:
        """Finish a request that got no response: the client gave up or the connection closed first.

        The event is sent without ``outcome``, ``error`` or ``response_size``; the
        ingest edge reads that like the gateway's unresolved requests (a stream
        that closed before its response). ``duration_ms`` is the time until the
        response was ready, or until the request was given up when none was.
        """
        if event is None:
            return
        try:
            if event.duration_ms is None:
                event.duration_ms = round(max(0.0, (time.perf_counter() - event.perf) * 1000), 3)
            event.outcome = None
            event.error_code = None
            event.error_message = None
            event.response = None
            self.queue(event)
        except Exception:
            logger.debug("mcp-use-analytics: could not record %s", event.method, exc_info=True)

    def queue(self, event: Event) -> None:
        """Hand a finished event to the channel (stdio events are sent right away)."""
        self.channel.enqueue(event, urgent=event.transport == "stdio")
        if self.options.debug:
            logger.debug(
                "mcp-use-analytics: recorded %s %s (%s, %.1f ms)",
                event.method,
                event.target or "",
                event.outcome or "no response",
                event.duration_ms or 0.0,
            )

    def _learn_server_info(self, info: Any) -> None:
        info = ex.dump_model(info)
        if isinstance(info, Mapping) and info.get("name"):
            self.server_info = dict(info)

    # -- delivery thread ----------------------------------------------------

    def _envelope_bytes(self) -> bytes:
        server_info = self.server_info
        cached = self._envelope
        if cached is not None and cached[0] is server_info:
            return cached[1]
        sdk = {key: value for key, value in self.sdk.items() if value}
        head = {"schema": SCHEMA, "sdk": sdk}
        if server_info:
            head["server"] = dict(server_info)
        encoded = dumps(head)[:-1] + b',"events":'
        self._envelope = (server_info, encoded)
        return encoded

    def encode(self, event: Event, config: RemoteConfig) -> tuple[bytes, bytes]:
        """The ``(envelope, event JSON)`` pair for one event, with payloads when allowed."""
        out: dict[str, Any] = {
            "id": event.id,
            "time": _iso(event.start),
            "duration_ms": event.duration_ms,
            "method": ex.cut(event.method, ex.LIMITS["method"]),
            "request_id": (
                ex.cut(event.request_id, ex.LIMITS["request_id"])
                if isinstance(event.request_id, str)
                else event.request_id
            ),
            "target": event.target,
            "outcome": event.outcome,
        }
        if event.outcome in ("tool_error", "error") and (event.error_code is not None or event.error_message):
            out["error"] = {
                key: value
                for key, value in (("code", event.error_code), ("message", event.error_message))
                if value is not None
            }
        out["session_id"] = event.session_id
        out["conversation_id"] = event.conversation_id
        if event.client and event.client[0]:
            out["client"] = {"name": event.client[0], "version": event.client[1]}
        if event.method == "initialize":
            client_info = ex.dump_model(event.client_info)
            if isinstance(client_info, Mapping):
                out["client_info"] = redact_payload(client_info, max_string_length=1024)
        out["protocol_version"] = event.protocol_version
        out["transport"] = event.transport
        out["stateless"] = event.stateless
        out["http"] = event.http
        if event.token_hash:
            actor: dict[str, str] = {"token_hash": event.token_hash}
            if config.identify_actors:
                if event.actor_name:
                    actor["name"] = event.actor_name
                if event.actor_email:
                    actor["email"] = event.actor_email
            out["actor"] = actor
        out["openai"] = event.openai
        out["trace_id"] = event.trace_id
        request_message: dict[str, Any] = {"jsonrpc": "2.0", "id": event.request_id, "method": event.method}
        if event.params is not None:
            request_message["params"] = event.params
        # Measured, not encoded: json.dumps would hold the GIL for the whole
        # message, stalling the server's event loop on large results.
        out["request_size"] = event.request_size if event.request_size is not None else json_size(request_message)
        if event.response is not None:
            out["response_size"] = json_size(event.response)
        if config.capture_payloads and self.options.capture_payloads is not False:
            out["request_payload"] = self._payload(request_message, "request", event)
            if event.response is not None:
                out["response_payload"] = self._payload(event.response, "response", event)
        compact = {key: value for key, value in out.items() if value is not None}
        return self._envelope_bytes(), dumps(compact)

    def _payload(self, message: Any, kind: Literal["request", "response"], event: Event) -> Any:
        payload = redact_payload(message)
        hook = self.options.redact
        if hook is not None:
            try:
                payload = hook(payload, PayloadContext(kind=kind, method=event.method, target=event.target))
            except Exception:
                logger.debug("mcp-use-analytics: redact hook failed; dropping the payload", exc_info=True)
                return None
        return bound_payload(payload)
