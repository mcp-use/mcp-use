"""Public types passed to the ``identify``, ``conversation_id`` and ``redact`` hooks."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict


@dataclass(frozen=True)
class RequestInfo:
    """What the ``identify`` and ``conversation_id`` hooks know about a request.

    Hooks run on the request path, inside the request's context, so they must be
    fast and must not do I/O. An exception in a hook is logged (with ``debug``)
    and ignored.

    Attributes:
        method: The JSON-RPC method, e.g. ``"tools/call"``.
        target: The tool name, resource URI or prompt name, when the method has one.
        params: The raw JSON-RPC ``params`` object (``None`` when absent).
        headers: Lowercased HTTP request headers; empty on stdio.
        session_id: The transport session id, when known.
        client_name: The MCP client's name, when known.
        client_version: The MCP client's version, when known.
        access_token: The raw ``Authorization: Bearer`` token, when present. It is
            never sent anywhere; only hashes of it are.
    """

    method: str
    target: str | None = None
    params: Mapping[str, Any] | None = None
    headers: Mapping[str, str] = field(default_factory=dict)
    session_id: str | None = None
    client_name: str | None = None
    client_version: str | None = None
    access_token: str | None = None


class Identity(TypedDict, total=False):
    """The end user behind a request, returned by an ``identify`` hook.

    Every key is optional and each one only replaces its own default, exactly as
    in the TypeScript SDK:

    Keys:
        id: A stable user id from your system (a string or a number). Only
            ``sha256(id)`` is sent, as the actor's ``token_hash``, in place of the
            Bearer token's hash. Leave it out when your callers send a Bearer
            token: the token hash is what the Manufact gateway uses for the same
            user, so their gateway and SDK traffic stay one actor.
        name: Display name, in place of the token's ``name`` claim.
        email: Email, in place of the token's ``email`` claim.

    ``name`` and ``email`` are sent only with an actor (an ``id`` or a Bearer
    token) and only when "identify actors" is on in the dashboard; they are
    dropped when longer than 256 and 320 characters. The ingest edge keeps
    them only next to a ``token_hash``, so a ``name`` or ``email`` without an
    ``id``, on a request without a Bearer token, sends no actor at all.
    """

    id: str
    name: str
    email: str


@dataclass(frozen=True)
class PayloadContext:
    """Which payload a ``redact`` hook is looking at.

    Attributes:
        kind: ``"request"`` (the JSON-RPC request) or ``"response"`` (its result or error).
        method: The JSON-RPC method.
        target: The tool name, resource URI or prompt name, when the method has one.
    """

    kind: Literal["request", "response"]
    method: str
    target: str | None = None


IdentifyHook = Callable[[RequestInfo], "Identity | Mapping[str, Any] | None"]
"""``identify(request) -> {"id"?, "name"?, "email"?} | None``.

``None`` keeps the defaults (the Bearer token's hash and its ``name``/``email``
claims), like ``undefined`` in the TypeScript SDK.
"""

ConversationIdHook = Callable[[RequestInfo], "str | None"]
"""``conversation_id(request) -> str | None``: groups events into one conversation in Sessions."""

RedactHook = Callable[[Any, PayloadContext], Any]
"""``redact(payload, context) -> payload``: runs after the default redactor; return ``None`` to drop it.

Runs on the background delivery thread, never on the request path.
"""
