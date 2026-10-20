from __future__ import annotations

import logging
from typing import Any

import pytest
from mock_ingest import API_KEY, MockIngest

import mcp_use_analytics
from mcp_use_analytics import _instrument, _mcp_v1, _mcp_v2, _transport


class FakeV1Server:
    """Shaped like the mcp 1.x low-level Server."""

    def __init__(self, name: str = "fake", version: str | None = "1.2.3") -> None:
        self.name = name
        self.version = version
        self.request_handlers: dict[type, Any] = {}

    async def run(self, read_stream: Any, write_stream: Any, options: Any, raise_exceptions: bool = False) -> None:
        pass


class FakeV2Server:
    """Shaped like the mcp 2.x low-level Server."""

    def __init__(self) -> None:
        self.name = "fake-v2"
        self.version = ""
        self.middleware: list[Any] = ["otel"]

    def add_request_handler(self, *args: Any) -> None:
        pass


def _class_in(module: str, base: type = object, **attrs: Any) -> type:
    return type("Server", (base,), {"__module__": module, **attrs})


def test_no_key_is_a_noop_with_one_warning(caplog: pytest.LogCaptureFixture) -> None:
    server = FakeV1Server()
    original_run = server.run
    with caplog.at_level(logging.WARNING, logger="mcp_use_analytics"):
        assert mcp_use_analytics.instrument(server) is server
        mcp_use_analytics.instrument(FakeV1Server())
    assert server.run == original_run and not hasattr(server, _mcp_v1.MARK)
    warnings = [r for r in caplog.records if "no analytics key" in r.message]
    assert len(warnings) == 1
    assert _transport.all_channels() == []


def test_key_and_endpoint_from_the_environment(monkeypatch: pytest.MonkeyPatch, ingest: MockIngest) -> None:
    monkeypatch.setenv("MANUFACT_ANALYTICS_KEY", API_KEY)
    monkeypatch.setenv("MANUFACT_ANALYTICS_URL", ingest.url + "/")
    server = mcp_use_analytics.instrument(FakeV1Server())
    recorder = getattr(server, _mcp_v1.MARK)
    assert recorder.channel.endpoint == ingest.url
    assert recorder.sdk["framework"] == "mcp-sdk-v1"
    assert recorder.server_info == {"name": "fake", "version": "1.2.3"}


def test_default_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    server = mcp_use_analytics.instrument(FakeV1Server(), api_key=API_KEY)
    assert getattr(server, _mcp_v1.MARK).channel.endpoint == "https://ingest.run.mcp-use.com"


@pytest.mark.parametrize("value", ["1", "true", "YES", "on"])
def test_disabled_by_environment(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("MANUFACT_ANALYTICS_DISABLED", value)
    server = mcp_use_analytics.instrument(FakeV1Server(), api_key=API_KEY)
    assert not hasattr(server, _mcp_v1.MARK)
    forced = mcp_use_analytics.instrument(FakeV1Server(), api_key=API_KEY, enabled=True)
    assert hasattr(forced, _mcp_v1.MARK)


def test_enabled_false() -> None:
    server = mcp_use_analytics.instrument(FakeV1Server(), api_key=API_KEY, enabled=False)
    assert not hasattr(server, _mcp_v1.MARK)


def test_unsupported_objects_are_returned_untouched(caplog: pytest.LogCaptureFixture) -> None:
    thing = object()
    with caplog.at_level(logging.WARNING, logger="mcp_use_analytics"):
        assert mcp_use_analytics.instrument(thing, api_key=API_KEY) is thing
    assert any("not a supported MCP server" in r.message for r in caplog.records)


def test_instrumentation_errors_never_escape(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    def broken(*_: Any) -> bool:
        raise RuntimeError("adapter bug")

    monkeypatch.setattr(_mcp_v1, "install", broken)
    server = FakeV1Server()
    with caplog.at_level(logging.WARNING, logger="mcp_use_analytics"):
        assert mcp_use_analytics.instrument(server, api_key=API_KEY) is server
    assert any("instrumentation failed" in r.message for r in caplog.records)


def test_v2_middleware_goes_first_and_only_once() -> None:
    server = FakeV2Server()
    mcp_use_analytics.instrument(server, api_key=API_KEY)
    mcp_use_analytics.instrument(server, api_key=API_KEY)
    assert isinstance(server.middleware[0], _mcp_v2.AnalyticsMiddleware)
    assert server.middleware[1:] == ["otel"]
    assert getattr(server, _mcp_v2.MARK).sdk["framework"] == "mcp-sdk-v2"


@pytest.mark.parametrize(
    ("module", "attribute", "framework"),
    [
        ("fastmcp.server.server", "_mcp_server", "fastmcp"),
        ("mcp_use.server.server", "_mcp_server", "mcp-use"),
        ("mcp.server.fastmcp.server", "_mcp_server", "mcp-sdk-v1"),
        ("mcp.server.mcpserver.server", "_lowlevel_server", "mcp-sdk-v2"),
    ],
)
def test_framework_detection(module: str, attribute: str, framework: str) -> None:
    inner = FakeV2Server() if attribute == "_lowlevel_server" else FakeV1Server()
    outer = _class_in(module)()
    setattr(outer, attribute, inner)
    resolved = _instrument._resolve(outer)
    assert resolved is not None and resolved[1] is inner and resolved[2] == framework


def test_wrapped_run_passes_through_untouched_streams() -> None:
    server = FakeV1Server()
    calls: list[tuple[Any, ...]] = []

    async def run(*args: Any, **kwargs: Any) -> str:
        calls.append(args)
        return "done"

    server.run = run  # type: ignore[method-assign]
    mcp_use_analytics.instrument(server, api_key=API_KEY)
    import asyncio

    assert asyncio.run(server.run("read", "write", "options")) == "done"
    read, write, options = calls[0]
    assert type(read).__name__ == "ReadProxy" and read._inner == "read"
    assert type(write).__name__ == "WriteProxy" and write._inner == "write"
    assert options == "options"


def test_flush_and_shutdown_without_events() -> None:
    assert mcp_use_analytics.flush(1)
    assert mcp_use_analytics.shutdown(1)


def test_debug_logs() -> None:
    logger = logging.getLogger("mcp_use_analytics")
    level, handlers = logger.level, list(logger.handlers)
    try:
        logger.setLevel(logging.NOTSET)
        mcp_use_analytics.instrument(FakeV1Server(), api_key=API_KEY, debug=True)
        assert logger.level == logging.DEBUG and logger.handlers
    finally:
        logger.setLevel(level)
        logger.handlers[:] = handlers
