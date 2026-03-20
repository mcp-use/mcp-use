"""Tests for inspector route helpers."""

from __future__ import annotations

import pytest
from starlette.requests import Request

from mcp_use.server.utils import inspector as inspector_utils


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int,
        text: str = "",
        content: bytes = b"",
        headers: dict[str, str] | None = None,
    ):
        self.status_code = status_code
        self.text = text
        self.content = content
        self.headers = headers or {}


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse):
        self._response = response

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, url: str, *, follow_redirects: bool = True) -> _FakeResponse:
        return self._response


def _make_request(path: str, query_string: bytes = b"") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": query_string,
        "headers": [(b"host", b"testserver")],
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 12345),
    }
    return Request(scope)


@pytest.mark.anyio
async def test_inspector_index_redirects_to_prefixed_path():
    response = await inspector_utils._inspector_index(
        _make_request("/mcp/inspector"),
        mcp_path="/mcp",
        inspector_path="/mcp/inspector",
    )

    assert response.status_code == 302
    assert response.headers["location"] == "http://testserver/mcp/inspector?autoConnect=http%3A%2F%2Ftestserver%2Fmcp"


@pytest.mark.anyio
async def test_inspector_index_rewrites_asset_paths_for_custom_mount(monkeypatch):
    html = """
    <html>
      <head>
        <script src="/inspector/assets/index.js"></script>
        <link rel="stylesheet" href="/inspector/assets/index.css">
      </head>
    </html>
    """

    monkeypatch.setattr(
        inspector_utils.httpx,
        "AsyncClient",
        lambda timeout=10.0: _FakeAsyncClient(_FakeResponse(status_code=200, text=html)),
    )

    response = await inspector_utils._inspector_index(
        _make_request("/mcp/inspector", b"autoConnect=http://testserver/mcp"),
        mcp_path="/mcp",
        inspector_path="/mcp/inspector",
    )

    body = response.body.decode("utf-8")
    assert response.status_code == 200
    assert f"{inspector_utils.INSPECTOR_CDN_BASE_URL}/assets/index.js" in body
    assert f"{inspector_utils.INSPECTOR_CDN_BASE_URL}/assets/index.css" in body
    assert "/inspector/assets/" not in body


def test_server_normalizes_inspector_prefix_and_legacy_full_path():
    from mcp_use.server.server import MCPServer

    prefixed = MCPServer(inspector_path="/mcp")
    legacy = MCPServer(inspector_path="/mcp/inspector")

    assert prefixed.inspector_path == "/mcp/inspector"
    assert legacy.inspector_path == "/mcp/inspector"
