"""``instrument()``, ``flush()`` and ``shutdown()``: the public entry points."""

from __future__ import annotations

import logging
import os
from importlib import metadata
from typing import Any, TypeVar

from . import _mcp_v1, _mcp_v2
from ._recorder import Options, Recorder
from ._transport import close_all, flush_all, get_channel, warn_once
from ._types import ConversationIdHook, IdentifyHook, RedactHook

logger = logging.getLogger("mcp_use_analytics")

DEFAULT_ENDPOINT = "https://ingest.run.mcp-use.com"
ENV_KEY = "MANUFACT_ANALYTICS_KEY"
ENV_URL = "MANUFACT_ANALYTICS_URL"
ENV_DISABLED = "MANUFACT_ANALYTICS_DISABLED"
# Serverless runtimes freeze the process between invocations: send right away
# instead of batching for a second (and call flush() before returning).
_SERVERLESS_ENV = ("VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "FUNCTIONS_WORKER_RUNTIME", "K_SERVICE")

ServerT = TypeVar("ServerT")


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _version(distribution: str) -> str | None:
    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return None


def _modules(obj: Any) -> list[str]:
    return [getattr(cls, "__module__", "") or "" for cls in type(obj).__mro__]


def _resolve(server: Any) -> tuple[str, Any, str, str | None] | None:
    """``(adapter, low-level server, framework, framework version)`` or ``None``."""
    lowlevel = server
    for attribute in ("_lowlevel_server", "_mcp_server"):  # mcp 2.x MCPServer, then FastMCP flavours
        inner = getattr(server, attribute, None)
        if inner is not None:
            lowlevel = inner
            break
    if _mcp_v2.is_v2_server(lowlevel):
        adapter = "v2"
    elif isinstance(getattr(lowlevel, "request_handlers", None), dict) and callable(getattr(lowlevel, "run", None)):
        adapter = "v1"
    else:
        return None
    modules = _modules(server)
    if any(module == "mcp_use" or module.startswith("mcp_use.") for module in modules):
        return adapter, lowlevel, "mcp-use", _version("mcp-use")
    if any(module == "fastmcp" or module.startswith("fastmcp.") for module in modules):
        return adapter, lowlevel, "fastmcp", _version("fastmcp")
    return adapter, lowlevel, f"mcp-sdk-{adapter}", _version("mcp")


def _server_info(lowlevel: Any) -> dict[str, Any] | None:
    name = getattr(lowlevel, "name", None)
    if not isinstance(name, str) or not name:
        return None
    version = getattr(lowlevel, "version", None)
    return {"name": name, "version": version} if isinstance(version, str) and version else {"name": name}


def _configure_debug() -> None:
    logger.setLevel(logging.DEBUG)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
        logger.addHandler(handler)


def instrument(
    server: ServerT,
    *,
    api_key: str | None = None,
    endpoint: str | None = None,
    enabled: bool | None = None,
    capture_payloads: bool | None = None,
    redact: RedactHook | None = None,
    identify: IdentifyHook | None = None,
    conversation_id: ConversationIdHook | str | None = None,
    debug: bool = False,
) -> ServerT:
    """Send one analytics event per MCP request this server handles to Manufact.

    Supports community ``fastmcp`` (2.x, 3.x, 4.x), the official ``mcp`` SDK
    (``FastMCP`` and the low-level ``Server`` on 1.x; ``MCPServer`` and the
    low-level ``Server`` on 2.x) and mcp-use's ``MCPServer``. Call it once,
    after creating the server and before serving; tools added later are
    covered too. Calling it again on the same server does nothing.

    Recording never raises into a request and never waits on the network:
    events go to a bounded in-memory queue that a background thread sends in
    batches. Requests forwarded by the Manufact gateway (``X-Gateway-Request-Id``)
    are skipped because the gateway already records them.

    Args:
        server: The server to instrument; it is returned unchanged.
        api_key: The server's analytics key (``mfi_...``). Defaults to
            ``$MANUFACT_ANALYTICS_KEY``. Without a key nothing is installed and
            one warning is logged.
        endpoint: Ingest origin. Defaults to ``$MANUFACT_ANALYTICS_URL``, else
            ``https://ingest.run.mcp-use.com``.
        enabled: ``False`` turns analytics off; ``True`` turns it on even when
            ``$MANUFACT_ANALYTICS_DISABLED`` is set. ``None`` follows that variable.
        capture_payloads: ``False`` never sends request/response payloads.
            ``None`` (or ``True``) sends them only when payload capture is on in
            the dashboard, after redaction.
        redact: ``redact(payload, context) -> payload`` applied after the default
            redactor, on the delivery thread; return ``None`` to drop a payload.
        identify: ``identify(request) -> {"id"?, "name"?, "email"?} | None``
            naming the end user. Each key replaces only its own default: ``id``
            (sent as ``sha256(id)``) replaces the Bearer token hash, ``name`` and
            ``email`` replace the token's claims (sent only when "identify
            actors" is on in the dashboard); ``None`` keeps all defaults. Without
            it the actor is derived from the ``Authorization: Bearer`` token
            exactly like the gateway does.
        conversation_id: A string, or ``conversation_id(request) -> str | None``,
            grouping requests into one conversation in Sessions.
        debug: Log every recorded event and delivery to the
            ``mcp_use_analytics`` logger at DEBUG level.

    Returns:
        ``server``, so ``mcp = instrument(FastMCP("demo"))`` works.
    """
    try:
        _instrument(
            server,
            api_key=api_key,
            endpoint=endpoint,
            enabled=enabled,
            options=Options(
                capture_payloads=capture_payloads,
                redact=redact,
                identify=identify,
                conversation_id=conversation_id,
                debug=debug,
            ),
        )
    except Exception:
        logger.warning("mcp-use-analytics: instrumentation failed; the server runs without analytics", exc_info=True)
    return server


def _instrument(
    server: Any, *, api_key: str | None, endpoint: str | None, enabled: bool | None, options: Options
) -> None:
    if options.debug:
        _configure_debug()
    if enabled is False or (enabled is None and _truthy(os.environ.get(ENV_DISABLED))):
        logger.debug("mcp-use-analytics: disabled")
        return
    key = (api_key or os.environ.get(ENV_KEY) or "").strip()
    if not key:
        warn_once(
            "no-key",
            "mcp-use-analytics: no analytics key (pass api_key= or set %s); analytics is disabled",
            ENV_KEY,
        )
        return
    if not key.startswith("mfi_"):
        warn_once("key-format", "mcp-use-analytics: the analytics key does not look like a Manufact key (mfi_...)")
    resolved = _resolve(server)
    if resolved is None:
        warn_once(
            f"unsupported:{type(server).__qualname__}",
            "mcp-use-analytics: %s is not a supported MCP server; analytics is disabled for it",
            type(server).__qualname__,
        )
        return
    adapter, lowlevel, framework, framework_version = resolved
    url = (endpoint or os.environ.get(ENV_URL) or DEFAULT_ENDPOINT).strip().rstrip("/")
    channel = get_channel(url, key)
    if any(os.environ.get(name) for name in _SERVERLESS_ENV):
        channel.flush_interval = 0.0
    recorder = Recorder(
        channel,
        options,
        framework=framework,
        framework_version=framework_version,
        server_info=_server_info(lowlevel),
    )
    installed = (_mcp_v2 if adapter == "v2" else _mcp_v1).install(lowlevel, recorder)
    if installed:
        logger.debug(
            "mcp-use-analytics: instrumented %s (%s %s)", type(server).__qualname__, framework, framework_version
        )
    else:
        logger.debug("mcp-use-analytics: %s is already instrumented", type(server).__qualname__)


def flush(timeout: float | None = 5.0) -> bool:
    """Send everything recorded so far and wait for it.

    Call it at the end of a serverless invocation (or before exiting a script);
    long-running servers do not need it. At interpreter exit a flush with a
    2-second timeout runs automatically. It waits only for the events recorded
    before the call, so requests that other threads or invocations keep
    recording meanwhile do not hold it up.

    Args:
        timeout: Seconds to wait at most; ``None`` waits without a limit.

    Returns:
        ``True`` when every event recorded before the call was delivered (or
        dropped as undeliverable) within ``timeout``.
    """
    try:
        _mcp_v1.release_deferred()
        return flush_all(timeout)
    except Exception:
        logger.debug("mcp-use-analytics: flush failed", exc_info=True)
        return False


def shutdown(timeout: float | None = 5.0) -> bool:
    """Flush, then stop delivery for good; later events are dropped.

    Returns:
        ``True`` when every event recorded before the call was delivered (or
        dropped as undeliverable) within ``timeout``.
    """
    try:
        _mcp_v1.release_deferred()
        return close_all(timeout)
    except Exception:
        logger.debug("mcp-use-analytics: shutdown failed", exc_info=True)
        return False
