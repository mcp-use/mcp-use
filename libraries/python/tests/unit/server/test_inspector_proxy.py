"""
Unit tests for inspector proxy and telemetry endpoints.

Tests verify that:
1. The proxy endpoint forwards requests to the target server
2. Missing X-Target-URL header returns 400
3. Invalid target URL returns 400
4. Connection errors return 502
5. Telemetry no-op endpoint returns 200
6. Infrastructure/CDN headers are stripped before proxying
7. __mcp_target query param works for OAuth discovery
8. Query parameters are preserved in discovery mode
9. Custom inspector_path is respected for proxy base stripping
10. SSE streaming responses are forwarded without buffering
11. Relative redirects are resolved against the upstream URL
12. Path-specific OAuth protected-resource rewrites preserve the suffix
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from starlette.responses import StreamingResponse

from mcp_use.server import MCPServer
from mcp_use.server.utils.inspector import inspector_telemetry_noop, make_inspector_proxy

DEFAULT_PROXY_BASE = "/inspector/api/proxy"


def _make_proxy():
    """Create a proxy handler with the default base path."""
    return make_inspector_proxy(DEFAULT_PROXY_BASE)


def _make_request(
    *,
    headers=None,
    method="POST",
    query_params=None,
    url_path="/inspector/api/proxy",
    scheme="http",
    netloc="localhost:8080",
):
    """Create a mock Starlette request for proxy tests."""
    request = AsyncMock()
    request.headers = headers or {}
    request.method = method
    request.query_params = query_params or {}
    mock_url = MagicMock()
    mock_url.path = url_path
    mock_url.scheme = scheme
    mock_url.netloc = netloc
    request.url = mock_url
    return request


def _mock_streaming_response(*, status_code=200, chunks, headers=None):
    """Create a mock httpx Response that supports aiter_bytes / aread / aclose."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = httpx.Headers(headers or {})

    async def aiter_bytes():
        for chunk in chunks:
            yield chunk

    resp.aiter_bytes = aiter_bytes
    resp.aread = AsyncMock(return_value=b"".join(chunks))
    resp.aclose = AsyncMock()
    return resp


def _patch_client(mock_response=None, *, side_effect=None):
    """Return a context manager that patches httpx.AsyncClient and yields the mock client."""
    mock_client = AsyncMock()
    if side_effect:
        mock_client.send = AsyncMock(side_effect=side_effect)
    else:
        mock_client.send = AsyncMock(return_value=mock_response)
    mock_client.build_request = MagicMock(return_value="built_request")
    mock_client.aclose = AsyncMock()

    patcher = patch("mcp_use.server.utils.inspector.httpx.AsyncClient", return_value=mock_client)
    return patcher, mock_client


class TestInspectorProxy:
    """Test the inspector proxy endpoint."""

    @pytest.mark.asyncio
    async def test_proxy_missing_target_url(self):
        """Proxy should return 400 when X-Target-URL header is missing."""
        proxy = _make_proxy()
        request = _make_request(headers={})
        response = await proxy(request)
        assert response.status_code == 400
        assert b"Missing X-Target-URL" in response.body

    @pytest.mark.asyncio
    async def test_proxy_invalid_target_url(self):
        """Proxy should return 400 for an invalid target URL."""
        proxy = _make_proxy()
        request = _make_request(headers={"x-target-url": "not-a-valid-url"})
        response = await proxy(request)
        assert response.status_code == 400
        assert b"Invalid target URL" in response.body

    @pytest.mark.asyncio
    async def test_proxy_forwards_request(self):
        """Proxy should forward the request to the target URL and return the response."""
        proxy = _make_proxy()
        request = _make_request(
            headers={"x-target-url": "http://localhost:8000/mcp", "content-type": "application/json"},
        )
        request.body = AsyncMock(return_value=b'{"jsonrpc":"2.0","method":"initialize","id":1}')

        mock_response = _mock_streaming_response(
            status_code=200,
            chunks=[b'{"jsonrpc":"2.0","result":{},"id":1}'],
            headers={"content-type": "application/json"},
        )

        patcher, mock_client = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            assert response.status_code == 200
            mock_client.build_request.assert_called_once()
            build_kwargs = mock_client.build_request.call_args
            assert build_kwargs.kwargs["url"] == "http://localhost:8000/mcp"
            assert build_kwargs.kwargs["method"] == "POST"

    @pytest.mark.asyncio
    async def test_proxy_connection_refused(self):
        """Proxy should return 502 when target server is not reachable."""
        proxy = _make_proxy()
        request = _make_request(headers={"x-target-url": "http://localhost:9999/mcp"})
        request.body = AsyncMock(return_value=b"")

        patcher, mock_client = _patch_client(side_effect=httpx.ConnectError("Connection refused"))
        with patcher:
            response = await proxy(request)

            assert response.status_code == 502
            assert b"Connection refused" in response.body
            mock_client.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_proxy_redirect_follow_up_connection_refused(self):
        """Redirect follow-up connection failures should still return the proxy 502 response."""
        proxy = _make_proxy()
        request = _make_request(headers={"x-target-url": "http://localhost:8000/mcp"})
        request.body = AsyncMock(return_value=b"")

        redirect_response = _mock_streaming_response(
            status_code=302, chunks=[], headers={"location": "/oauth/callback"}
        )

        patcher, mock_client = _patch_client(side_effect=[redirect_response, httpx.ConnectError("Connection refused")])
        with patcher:
            response = await proxy(request)

            assert response.status_code == 502
            assert b"Connection refused" in response.body
            assert redirect_response.aclose.await_count == 1
            mock_client.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_proxy_redirect_follow_up_generic_failure(self):
        """Redirect follow-up non-connection failures should return the proxy 500 response."""
        proxy = _make_proxy()
        request = _make_request(headers={"x-target-url": "http://localhost:8000/mcp"})
        request.body = AsyncMock(return_value=b"")

        redirect_response = _mock_streaming_response(
            status_code=302, chunks=[], headers={"location": "http://invalid.example/oauth"}
        )

        patcher, mock_client = _patch_client(side_effect=[redirect_response, RuntimeError("redirect failed")])
        with patcher:
            response = await proxy(request)

            assert response.status_code == 500
            assert b"Proxy request failed" in response.body
            assert b"redirect failed" in response.body
            assert redirect_response.aclose.await_count == 1
            mock_client.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_proxy_strips_infrastructure_headers(self):
        """Proxy should strip host, target, forwarded, and CDN headers."""
        proxy = _make_proxy()
        request = _make_request(
            headers={
                "x-target-url": "http://localhost:8000/mcp",
                "host": "myhost:3000",
                "content-length": "42",
                "content-type": "application/json",
                "mcp-session-id": "abc123",
                "x-forwarded-for": "1.2.3.4",
                "x-forwarded-host": "public.example.com",
                "cf-ray": "abc123",
                "cf-connecting-ip": "5.6.7.8",
                "x-proxy-foo": "bar",
                "x-mcp-target": "something",
                "x-original-host": "orig.example.com",
                "cdn-loop": "cloudflare",
            },
        )
        request.body = AsyncMock(return_value=b"{}")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[b"{}"], headers={"content-type": "application/json"}
        )

        patcher, mock_client = _patch_client(mock_response)
        with patcher:
            await proxy(request)

            forwarded_headers = mock_client.build_request.call_args.kwargs["headers"]
            for h in (
                "host",
                "x-target-url",
                "content-length",
                "x-forwarded-for",
                "x-forwarded-host",
                "cf-ray",
                "cf-connecting-ip",
                "x-proxy-foo",
                "x-mcp-target",
                "x-original-host",
                "cdn-loop",
            ):
                assert h not in forwarded_headers, f"header {h!r} should have been stripped"
            assert forwarded_headers["content-type"] == "application/json"
            assert forwarded_headers["mcp-session-id"] == "abc123"

    @pytest.mark.asyncio
    async def test_proxy_oauth_discovery_via_query_param(self):
        """Proxy should use __mcp_target query param for OAuth discovery routing."""
        proxy = _make_proxy()
        request = _make_request(
            headers={"content-type": "application/json"},
            method="GET",
            query_params={"__mcp_target": "https://mcp.example.com"},
            url_path="/inspector/api/proxy/.well-known/oauth-protected-resource",
        )
        request.body = AsyncMock(return_value=b"")

        mock_response = _mock_streaming_response(
            status_code=200,
            chunks=[b'{"resource":"https://mcp.example.com"}'],
            headers={"content-type": "application/json"},
        )

        patcher, mock_client = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            assert response.status_code == 200
            build_kwargs = mock_client.build_request.call_args.kwargs
            assert build_kwargs["url"] == "https://mcp.example.com/.well-known/oauth-protected-resource"
            assert build_kwargs["method"] == "GET"

    @pytest.mark.asyncio
    async def test_proxy_discovery_preserves_query_params(self):
        """Proxy should forward extra query params (not __mcp_target) in discovery mode."""
        proxy = _make_proxy()
        request = _make_request(
            headers={"content-type": "application/json"},
            method="GET",
            query_params={"__mcp_target": "https://mcp.example.com", "cursor": "abc", "limit": "10"},
            url_path="/inspector/api/proxy/resource",
        )
        request.body = AsyncMock(return_value=b"")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[b"{}"], headers={"content-type": "application/json"}
        )

        patcher, mock_client = _patch_client(mock_response)
        with patcher:
            await proxy(request)

            target_url = mock_client.build_request.call_args.kwargs["url"]
            assert target_url.startswith("https://mcp.example.com/resource?")
            assert "cursor=abc" in target_url
            assert "limit=10" in target_url
            assert "__mcp_target" not in target_url

    @pytest.mark.asyncio
    async def test_proxy_discovery_preserves_duplicate_query_params(self):
        """Proxy should preserve duplicate query parameters in discovery mode."""
        proxy = _make_proxy()
        request = _make_request(
            headers={"content-type": "application/json"},
            method="GET",
            query_params=httpx.QueryParams(
                [("__mcp_target", "https://mcp.example.com"), ("cursor", "a"), ("cursor", "b")]
            ),
            url_path="/inspector/api/proxy/resource",
        )
        request.body = AsyncMock(return_value=b"")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[b"{}"], headers={"content-type": "application/json"}
        )

        patcher, mock_client = _patch_client(mock_response)
        with patcher:
            await proxy(request)

            target_url = mock_client.build_request.call_args.kwargs["url"]
            assert "cursor=a" in target_url
            assert "cursor=b" in target_url

    @pytest.mark.asyncio
    async def test_proxy_custom_inspector_path(self):
        """Proxy with custom base path should correctly strip the prefix for discovery."""
        custom_base = "/debug/api/proxy"
        proxy = make_inspector_proxy(custom_base)
        request = _make_request(
            headers={"content-type": "application/json"},
            method="GET",
            query_params={"__mcp_target": "https://mcp.example.com"},
            url_path="/debug/api/proxy/.well-known/openid-configuration",
        )
        request.body = AsyncMock(return_value=b"")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[b"{}"], headers={"content-type": "application/json"}
        )

        patcher, mock_client = _patch_client(mock_response)
        with patcher:
            await proxy(request)

            target_url = mock_client.build_request.call_args.kwargs["url"]
            assert target_url == "https://mcp.example.com/.well-known/openid-configuration"

    @pytest.mark.asyncio
    async def test_proxy_streams_sse_responses(self):
        """Proxy should stream SSE responses chunk-by-chunk, not buffer them."""
        proxy = _make_proxy()
        request = _make_request(
            headers={"x-target-url": "http://localhost:8000/mcp", "accept": "text/event-stream"},
        )
        request.body = AsyncMock(return_value=b'{"jsonrpc":"2.0","method":"initialize","id":1}')

        sse_chunks = [b"data: chunk1\n\n", b"data: chunk2\n\n"]
        mock_response = _mock_streaming_response(
            status_code=200, chunks=sse_chunks, headers={"content-type": "text/event-stream"}
        )

        patcher, _ = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            assert isinstance(response, StreamingResponse)
            assert response.status_code == 200
            assert response.media_type == "text/event-stream"

            collected = []
            async for chunk in response.body_iterator:
                collected.append(chunk)
            assert collected == sse_chunks

    @pytest.mark.asyncio
    async def test_proxy_non_sse_sets_content_length(self):
        """Non-streaming responses should be buffered with Content-Length set."""
        proxy = _make_proxy()
        request = _make_request(
            headers={"x-target-url": "http://localhost:8000/mcp", "content-type": "application/json"},
        )
        request.body = AsyncMock(return_value=b"{}")

        body_content = b'{"jsonrpc":"2.0","result":{},"id":1}'
        mock_response = _mock_streaming_response(
            status_code=200, chunks=[body_content], headers={"content-type": "application/json"}
        )

        patcher, _ = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            assert response.status_code == 200
            assert response.body == body_content
            assert response.headers["content-length"] == str(len(body_content))

    @pytest.mark.asyncio
    async def test_proxy_follows_redirect(self):
        """Proxy should follow one redirect hop instead of exposing upstream Location."""
        proxy = _make_proxy()
        request = _make_request(headers={"x-target-url": "http://localhost:8000/mcp"})
        request.body = AsyncMock(return_value=b"{}")

        redirect_response = _mock_streaming_response(
            status_code=302, chunks=[], headers={"location": "http://localhost:8000/mcp/v2"}
        )
        final_response = _mock_streaming_response(
            status_code=200, chunks=[b'{"ok":true}'], headers={"content-type": "application/json"}
        )

        patcher, mock_client = _patch_client(side_effect=[redirect_response, final_response])
        with patcher:
            response = await proxy(request)

            assert response.status_code == 200
            assert response.body == b'{"ok":true}'
            assert mock_client.send.call_count == 2
            assert mock_client.build_request.call_count == 2
            second_call_url = mock_client.build_request.call_args_list[1].kwargs["url"]
            assert second_call_url == "http://localhost:8000/mcp/v2"

    @pytest.mark.asyncio
    async def test_proxy_follows_relative_redirect(self):
        """Proxy should resolve a relative redirect against the original upstream URL."""
        proxy = _make_proxy()
        request = _make_request(headers={"x-target-url": "http://localhost:8000/mcp"})
        request.body = AsyncMock(return_value=b"{}")

        redirect_response = _mock_streaming_response(
            status_code=302, chunks=[], headers={"location": "/oauth/authorize"}
        )
        final_response = _mock_streaming_response(
            status_code=200, chunks=[b'{"ok":true}'], headers={"content-type": "application/json"}
        )

        patcher, mock_client = _patch_client(side_effect=[redirect_response, final_response])
        with patcher:
            response = await proxy(request)

            assert response.status_code == 200
            second_call_url = mock_client.build_request.call_args_list[1].kwargs["url"]
            assert second_call_url == "http://localhost:8000/oauth/authorize"

    @pytest.mark.asyncio
    async def test_proxy_rewrites_oauth_discovery_resource(self):
        """Proxy should rewrite the resource field in OAuth discovery JSON responses."""
        import json

        proxy = _make_proxy()
        upstream_body = json.dumps(
            {
                "resource": "https://mcp.example.com/mcp",
                "authorization_servers": ["https://auth.example.com"],
            }
        ).encode()

        request = _make_request(
            headers={"content-type": "application/json"},
            method="GET",
            query_params={"__mcp_target": "https://mcp.example.com"},
            url_path="/inspector/api/proxy/.well-known/oauth-protected-resource",
            scheme="http",
            netloc="localhost:8080",
        )
        request.body = AsyncMock(return_value=b"")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[upstream_body], headers={"content-type": "application/json"}
        )

        patcher, _ = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            body = json.loads(response.body)
            assert body["resource"] == "http://localhost:8080/inspector/api/proxy"
            assert body["authorization_servers"] == ["https://auth.example.com"]

    @pytest.mark.asyncio
    async def test_proxy_rewrites_path_specific_oauth_discovery_resource(self):
        """Proxy should preserve the path suffix for path-specific protected-resource metadata."""
        import json

        proxy = _make_proxy()
        upstream_body = json.dumps(
            {
                "resource": "https://mcp.example.com/mcp/foo",
                "authorization_servers": ["https://auth.example.com"],
            }
        ).encode()

        request = _make_request(
            headers={"content-type": "application/json"},
            method="GET",
            query_params={"__mcp_target": "https://mcp.example.com"},
            url_path="/inspector/api/proxy/.well-known/oauth-protected-resource/foo",
            scheme="http",
            netloc="localhost:8080",
        )
        request.body = AsyncMock(return_value=b"")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[upstream_body], headers={"content-type": "application/json"}
        )

        patcher, _ = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            body = json.loads(response.body)
            assert body["resource"] == "http://localhost:8080/inspector/api/proxy/foo"

    @pytest.mark.asyncio
    async def test_proxy_non_oauth_path_not_rewritten(self):
        """Proxy should NOT rewrite resource field for non-OAuth discovery paths."""
        import json

        proxy = _make_proxy()
        upstream_body = json.dumps({"resource": "https://mcp.example.com/mcp"}).encode()

        request = _make_request(
            headers={"x-target-url": "http://localhost:8000/mcp", "content-type": "application/json"},
            url_path="/inspector/api/proxy",
        )
        request.body = AsyncMock(return_value=b"{}")

        mock_response = _mock_streaming_response(
            status_code=200, chunks=[upstream_body], headers={"content-type": "application/json"}
        )

        patcher, _ = _patch_client(mock_response)
        with patcher:
            response = await proxy(request)

            body = json.loads(response.body)
            assert body["resource"] == "https://mcp.example.com/mcp"


class TestInspectorTelemetryNoop:
    """Test the telemetry no-op endpoint (PostHog / Scarf silencing)."""

    @pytest.mark.asyncio
    async def test_returns_200(self):
        """Telemetry no-op should return 200 for any POST."""
        request = AsyncMock()
        response = await inspector_telemetry_noop(request)
        assert response.status_code == 200


class TestInspectorRoutesRegistered:
    """Test that inspector routes are registered when debug=True."""

    def test_debug_server_has_proxy_route(self):
        """MCPServer with debug=True should register the proxy and sub-path proxy routes."""
        server = MCPServer(name="test-server", debug=True)
        route_paths = [r.path for r in server._custom_starlette_routes]
        proxy_route = next(r for r in server._custom_starlette_routes if r.path == "/inspector/api/proxy")

        assert "/inspector/api/proxy" in route_paths
        assert "/inspector/api/proxy/{path:path}" in route_paths
        assert "/inspector/api/tel/{path:path}" in route_paths
        assert {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} <= set(proxy_route.methods)

    def test_non_debug_server_has_no_proxy_route(self):
        """MCPServer with debug=False should not register inspector routes."""
        server = MCPServer(name="test-server", debug=False)
        route_paths = [r.path for r in server._custom_starlette_routes]
        assert "/inspector/api/proxy" not in route_paths

    def test_custom_inspector_path_routes(self):
        """MCPServer with custom inspector_path registers UI under custom path and API aliases under /inspector."""
        server = MCPServer(name="test-server", debug=True, inspector_path="/debug")
        route_paths = [r.path for r in server._custom_starlette_routes]

        # UI routes only under the custom path
        assert "/debug" in route_paths
        assert "/debug/{path:path}" in route_paths
        # API routes under the custom path
        assert "/debug/api/proxy" in route_paths
        assert "/debug/api/proxy/{path:path}" in route_paths
        assert "/debug/api/tel/{path:path}" in route_paths
        # API aliases under /inspector (CDN JS hardcodes these)
        assert "/inspector/api/proxy" in route_paths
        assert "/inspector/api/proxy/{path:path}" in route_paths
        assert "/inspector/api/tel/{path:path}" in route_paths
        # UI NOT aliased under /inspector
        assert "/inspector" not in route_paths

    def test_default_inspector_path_no_duplicate_routes(self):
        """MCPServer with default inspector_path should not register duplicate /inspector API routes."""
        server = MCPServer(name="test-server", debug=True, inspector_path="/inspector")
        route_paths = [r.path for r in server._custom_starlette_routes]
        assert route_paths.count("/inspector/api/proxy") == 1
